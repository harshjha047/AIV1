import { ObjectId } from 'mongodb';

const HEX_OBJECT_ID = /^[0-9a-fA-F]{24}$/;

export const toMongoId = (value) =>
  typeof value === 'string' && HEX_OBJECT_ID.test(value) ? new ObjectId(value) : value;

export const idToString = (value) => (value === null || value === undefined ? null : String(value));
