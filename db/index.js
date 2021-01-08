import { ObjectId } from "mongodb";
import client from "./client";

export const getXCollection = async () => {
  try {
    return await client.db("xdb").collection("xcollection").find().toArray();
  } catch (err) {
    return err;
    throw new Error(err);
  }
};

export const addToXCollection = async (obj) => {
  try {
    return await client.db("xdb").collection("xcollection").insertOne(obj);
  } catch (err) {
    throw new Error(err);
  }
};

export const replaceInXCollection = async (objToDelete, newObj) => {
  try {
    return await client
      .db("xdb")
      .collection("xcollection")
      .replaceOne({ _id: ObjectId(objToDelete._id) }, newObj);
  } catch (err) {
    throw new Error(err);
  }
};
