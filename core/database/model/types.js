import dedent from 'dedent';
import invariant from 'invariant';
import * as base64 from 'base64-js';

import defined from '~app/core/defined';
import getEntries from '~app/core/getEntries';
import moment from '~app/core/moment';
import DayString from '~app/core/dayString';

import Model from './model';

const Types = {};

function throwError(msg) {
  throw new Error(msg);
}

Types.RAW = function (props) {
  return {
    default: null,
    serialize: (obj, ctx) => {
      if (!defined(obj)) return null;
      if (obj instanceof Object) return obj.valueOf();
      return obj;
    },
    deserialize: (obj) => defined(obj) ? obj : null,
    ...props,
  };
};

Types.NUMBER = Types.RAW;
Types.INTEGER = Types.NUMBER;
Types.INT = Types.NUMBER;

Types.BOOLEAN = Types.RAW;
Types.BOOL = Types.BOOLEAN;

Types.STRING = Types.RAW;
Types.STR = Types.STRING;
Types.TEXT = Types.STRING;

Types.DATE = function (props) {
  return {
    default: null,
    serialize: (obj, ctx) => defined(obj) ? DayString(obj).toString() : null,
    deserialize: (obj) => defined(obj) ? DayString(obj).toString() : null,
    ...props,
  };
};

Types.DATETIME = function (props) {
  return {
    default: null,
    serialize: (obj, ctx) => defined(obj) ? moment(obj).toISOString() : null,
    deserialize: (obj) => defined(obj) ? moment(obj).toDate() : null,
    ...props,
  };
};

Types.BLOB = function (props) {
  return {
    default: null,
    serialize: (obj, ctx) => defined(obj) ? base64.fromByteArray(obj) : null,
    deserialize: (obj) => defined(obj) ? base64.toByteArray(obj) : null,
    ...props,
  };
};

Types.OBJECT = function (props) {
  return {
    default: null,
    object: true,
    serialize: (obj, ctx) => {
      if (!defined(obj)) return null;
      if (Model.isInstance(obj)) {
        return obj.toJS();
      }
      return obj;
    },
    deserialize: (obj) => defined(obj) ? obj : null,
    ...props,
  };
};

Types.REF = function (keyPath, props) {
  return {
    ref: true,
    refKeyPath: keyPath,
    readonly: true,
    transient: true,
    serialize: (obj, ctx) => throwError('not implemented'),
    deserialize: (obj) => throwError('type is readonly'),
    ...props,
  };
};

Types.TRANSIENT = function (props) {
  return {
    default: null,
    transient: true,
    serialize: (obj, ctx) => throwError('type cannot be serialized'),
    deserialize: (obj) => throwError('type cannot be deserialized'),
    ...props,
  };
};

Types.ID = function (props) {
  const type = Types.INT();
  return {
    ...type,
    primary: true,
    ...props,
  };
};

Types.MODEL = function (...args) {
  invariant(
    args.length > 0 && args.length < 3,
    'invalid signature, use either MODEL(modelType[, props]) or MODEL(props)',
  );

  let deserialize;
  let props;
  if (Model.is(args[0])) {
    props = {};
    if (args.length > 1) {
      props = Object.assign({}, args[1]);
    }
    props.modelType = args[0];
  }
  else {
    props = args[0];
  }

  // custom deserialize always wins
  if (props.deserialize) {
    deserialize = props.deserialize;
  }
  else if (props.modelType) {
    deserialize = obj => Model.deserialize(props.modelType, obj);
  }
  else {
    invariant(
      props.transient,
      dedent`
        must specify a "modelType" a custom "deserialize" function for any \
        non-transient model fields \
      `,
    );
    deserialize = obj => throwError('type cannot be deserialized');
  }


  return {
    default: null,
    object: true,
    serialize: (obj, ctx) => {
      return Model.serialize(obj);
    },
    ...props,
    // override the deserialize from props
    deserialize,
  };
};

Types.LISTOF = function (itemType, props) {
  return {
    itemType,
    object: true,
    default: () => [],
    serialize: (obj, ctx) => {
      if (!defined(obj)) return null;
      return Array.from(obj).map(o => itemType.serialize(o, obj));
    },
    deserialize: (obj) => {
      if (!defined(obj)) return null;
      return Array.from(obj).map(o => itemType.deserialize(o));
    },
    ...props,
  };
};

export default Types;
