import { ObjectId } from "mongodb";
import client from "./client";

export const getCollection = async (collectionName, sortOptions = null) => {
  try {
    if (sortOptions) {
      return await client
        .db("xdb")
        .collection(collectionName)
        .find()
        .sort(sort)
        .toArray();
    } else {
      return await client.db("xdb").collection(collectionName).find().toArray();
    }
  } catch (err) {
    return err;
    throw new Error(err);
  }
};

export const addToCollection = async (collectionName, obj) => {
  try {
    return await client.db("xdb").collection(collectionName).insertOne(obj);
  } catch (err) {
    throw new Error(err);
  }
};

export const updateInCollection = async (
  collectionName,
  objToUpdate,
  setOptions
) => {
  try {
    return await client
      .db("xdb")
      .collection(collectionName)
      .updateOne({ _id: ObjectId(objToUpdate._id) }, { $set: setOptions });
  } catch (err) {
    throw new Error(err);
  }
};

export const replaceInCollection = async (
  collectionName,
  objToDelete,
  newObj
) => {
  try {
    return await client
      .db("xdb")
      .collection(collectionName)
      .replaceOne({ _id: ObjectId(objToDelete._id) }, newObj);
  } catch (err) {
    throw new Error(err);
  }
};
