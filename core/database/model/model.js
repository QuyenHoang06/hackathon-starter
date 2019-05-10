import freeze from 'deep-freeze';
import lodash from 'lodash';
import {Record as ImmutableRecord} from 'immutable';
import invariant from 'invariant';

import defined from '~app/core/defined';
import getEntries from '~app/core/getEntries';
import KeyPath from '~app/core/keyPath';

const MODEL_SENTINEL = Symbol('@@MODEL@@');

const CommonMeta = {
  serializeField(fieldName, obj) {
    const value = this.fields[fieldName].serialize(obj[fieldName], obj);
    return value;
  },
  deserializeField(fieldName, value) {
    const fieldValue = this.fields[fieldName].deserialize(value);
    return fieldValue;
  },
};

const CommonMethods = {
  clone(values) {
    return this.withMutations(rec => {
      getEntries(values).forEach(([k, v]) => {
        rec.set(k, v);
        if (lodash.isObject(v)) {
          freeze(v);
        }
      });
    });
  },
};

function createModel({fields, meta = {}, ...methods}) {
  const fieldNames = Object.keys(fields);
  const recordSchema = {};
  const refs = {};
  const persistentFieldNames = fieldNames.filter(n => !fields[n].transient);

  fieldNames.forEach(name => {
    const field = fields[name];
    if (field.ref) {
      refs[name] = field.refKeyPath;
    }
    else {
      if (typeof field.default === 'function') {
        recordSchema[name] = undefined;
      }
      else {
        recordSchema[name] = field.default;
      }
    }
  });

  if (defined(meta.polymorphicOn)) {
    invariant(
      meta.polymorphicMap,
      'must define a "polymorphicMap" attribute to use "polymorphicOn"',
    );
  }

  const StateRecord = ImmutableRecord(recordSchema);

  function ModelRecord(values = {}) {
    if (!(this instanceof ModelRecord)) {
      return new ModelRecord(values);
    }
    values = (
      getEntries(fields)
        .map(([name, field]) => {
          let v = values[name];
          if (v === undefined) {
            if (typeof field.default === 'function') {
              v = field.default();
            }
            else if (field.hasOwnProperty('default')) {
              v = field.default;
            }
            // if the user didn't explicitly define "default" then set it null
            else {
              v = null;
            }
          }
          return [name, v];
        })
        .reduce((obj, [k, v]) => {
          obj[k] = v;
          return obj;
        }, {})
    );
    StateRecord.call(this, values);
    freeze(this);
  }

  ModelRecord.prototype = Object.create(StateRecord.prototype);
  ModelRecord.prototype.constructor = ModelRecord;

  ModelRecord[MODEL_SENTINEL] = true;

  Object.assign(ModelRecord, {
    fields,
    fieldNames,
    refs,
    persistentFieldNames,
    excludeFieldsFromSerialize: [],
    ...CommonMeta,
    ...meta,
  });
  Object.assign(ModelRecord.prototype, {
    ...CommonMethods,
    ...methods,
  });

  // define readonly getters for refs
  getEntries(refs).forEach(([key, path]) => {
    Object.defineProperty(ModelRecord.prototype, key, {
      get: function () {
        return KeyPath.get(this, path);
      },
    });
  });
  return ModelRecord;
}

function getModelType(obj) {
  if (obj) {
    if (obj[MODEL_SENTINEL]) {
      return obj;
    }
    else if (obj.constructor && obj.constructor[MODEL_SENTINEL]) {
      return obj.constructor;
    }
  }
  throw new Error('object is not a model type');
}

function isModelType(maybeModel) {
  return !!(maybeModel && maybeModel[MODEL_SENTINEL]);
}

function isModelInstance(maybeModel) {
  return !!(
    maybeModel &&
    maybeModel.constructor &&
    maybeModel.constructor[MODEL_SENTINEL]
  );
}

function modelToObject(model) {
  if (!defined(model)) return null;
  const modelType = Model.getType(model);
  return (
    getEntries(modelType.fields)
      .filter(([fieldName]) => (
        (modelType.fields[fieldName] && !modelType.fields[fieldName].transient) &&
        !modelType.excludeFieldsFromSerialize.includes(fieldName)
      ))
      .map(([fieldName, fieldType]) => {
        const fieldValue = model[fieldName];
        const serializedName = fieldType.serializedName || fieldName;
        return [serializedName, fieldType.serialize(fieldValue, model)];
      })
      .reduce((obj, [fieldName, fieldValue]) => {
        obj[fieldName] = fieldValue;
        return obj;
      }, {})
  );
}

function getFieldsBySerializedName(modelType) {
  return (
    getEntries(modelType.fields)
      .map(([fieldName, fieldType]) => {
        const serializedName = fieldType.serializedName || fieldName;
        return [serializedName, [fieldName, fieldType]];
      })
      .reduce((obj, [serializedName, fieldInfo]) => {
        obj[serializedName] = fieldInfo;
        return obj;
      }, {})
  );
}

function simpleObjectToModel(modelType, obj) {
  const serializedFields = getFieldsBySerializedName(modelType);
  const modelValues = (
    getEntries(obj)
      .map(([serializedName, fieldValue]) => {
        const [fieldName, fieldType] = serializedFields[serializedName];
        return [fieldName, fieldType.deserialize(fieldValue)];
      })
      .reduce((obj, [fieldName, fieldValue]) => {
        obj[fieldName] = fieldValue;
        return obj;
      }, {})
  );
  return new modelType(modelValues);
}

function polymorphicObjectToModel(modelType, obj) {
  // determine the subtype based on the value of the polymorphicOn field
  const fieldName = modelType.polymorphicOn;
  const fieldType = modelType.fields[fieldName];
  const serializedName = fieldType.serializedName || fieldName;
  const cstruct = obj[serializedName];
  const value = modelType.deserializeField(fieldName, cstruct);
  const subType = modelType.polymorphicMap[value];

  // unable to find a polymorphic mapping, just return the parent type
  if (!defined(subType)) {
    return simpleObjectToModel(modelType, obj);
  }

  return simpleObjectToModel(subType, obj);
}

function objectToModel(modelType, obj) {
  if (!defined(obj)) return null;
  if (modelType.polymorphicOn) {
    return polymorphicObjectToModel(modelType, obj);
  }
  return simpleObjectToModel(modelType, obj);
}

function createModelAdapter(toModelType, fromModelType) {
  const fieldMap = {};
  const toFieldNames = toModelType.fieldNames;
  const fromFieldNames = fromModelType.fieldNames;
  for (let toName of toFieldNames) {
    if (defined(fieldMap[toName])) return;
    if (fromFieldNames.includes(toName)) {
      fieldMap[toName] = toName;
    }
  }
  return function (obj) {
    const values = (
      getEntries(fieldMap)
        .map(([toField, fromField]) => {
          const value = KeyPath.get(obj, fromField);
          return [toField, value];
        })
        .reduce((obj, [k, v]) => {
          obj[k] = v;
          return obj;
        }, {})
    );
    return new toModelType(values);
  };
}

const Model = {
  createType: createModel,
  getType: getModelType,
  is: isModelType,
  isInstance: isModelInstance,
  serialize: modelToObject,
  deserialize: objectToModel,
  createAdapter: createModelAdapter,
};

export default Model;
