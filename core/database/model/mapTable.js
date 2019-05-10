import invariant from 'invariant';

import defined from '~app/core/defined';
import getEntries from '~app/core/getEntries';
import Model from './model';

const CommonMeta = {
  serializeColumn(columnName, obj) {
    const fieldName = this.columns[columnName];
    const fieldType = this.fields[fieldName];
    let value = this.serializeField(fieldName, obj);
    if (defined(value) && fieldType.object) {
      value = JSON.stringify(value);
    }
    return value;
  },

  deserializeColumn(columnName, cstruct) {
    const fieldName = this.columns[columnName];
    const fieldType = this.fields[fieldName];
    if (defined(cstruct) && fieldType.object) {
      cstruct = JSON.parse(cstruct);
    }
    const value = this.deserializeField(fieldName, cstruct);
    return [fieldName, value];
  },
};

function simpleFromRow(row) {
  const values = (
    this.columnNames
      .map(columnName => {
        const cstruct = row[columnName];
        return this.deserializeColumn(columnName, cstruct);
      })
      .reduce((obj, [k, v]) => {
        obj[k] = v;
        return obj;
      }, {})
  );
  return new this(values);
}

function polymorphicFromRow(row) {
  const fieldType = this.fields[this.polymorphicOn];
  const columnName = fieldType.columnName || this.polymorphicOn;
  const cstruct = row[columnName];
  const [_, value] = this.deserializeColumn(columnName, cstruct);
  const subType = this.polymorphicMap[value];

  // unable to find a polymorphic mapping, just return the parent type
  if (!defined(subType)) {
    return simpleFromRow.call(this, row);
  }

  return subType.fromRow(row);
}

function mapTable({ tableName, fields, meta = {}, ...methods }) {
  invariant(defined(tableName), 'expected a value for tableName');
  const fieldNames = Object.keys(fields);
  const columns = {};
  const primaryKeys = [];
  fieldNames.forEach(name => {
    const fieldType = fields[name];
    const columnName = fieldType.columnName || name;
    if (fieldType.primary) {
      primaryKeys.push(columnName);
    }
    if (!fieldType.transient) {
      columns[columnName] = name;
    }
  });
  const columnNames = Object.keys(columns);
  invariant(primaryKeys.length === 1, 'expected one primary key field');
  invariant(columnNames.length > 0, 'expected at least one column');

  let fromRow = simpleFromRow;
  if (defined(meta.polymorphicOn)) {
    invariant(
      meta.polymorphicMap,
      'must define a "polymorphicMap" attribute to use "polymorphicOn"',
    );
    fromRow = polymorphicFromRow;
  }

  const recordType = Model.createType({
    fields,
    meta: {
      tableName,
      columnNames,
      columns,
      primaryKeys,
      fromRow,
      ...CommonMeta,
      ...meta,
    },
    ...methods,
  });
  return recordType;
}

export default mapTable;
