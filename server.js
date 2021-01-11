import cors from "cors";
import express from "express";
import Web3 from "web3";
import bn from "bn.js";

import dbClient from "./db/client";

import NftxContract from "./contracts/NFTXv4.json";
import XStoreContract from "./contracts/XStore.json";
import Erc20Contract from "./contracts/ERC20.json";

import addresses from "./addresses/mainnet.json";

import xcollection from "./routes/xcollection";
import {
  getCollection,
  addToCollection,
  deleteFromCollection,
  updateInCollection,
  replaceInCollection,
} from "./db";
import e from "express";

const app = express();

// testing
app.get("/", (_, res) => {
  res.send("<h1>Hello from Express Server!</h1>");
});

const web3 = new Web3(
  "https://eth-mainnet.alchemyapi.io/v2/fL1uiXELcu8QeuLAxoCNmnbf_XuVlHBD"
);

const nftx = new web3.eth.Contract(NftxContract.abi, addresses.nftxProxy);
const xStore = new web3.eth.Contract(XStoreContract.abi, addresses.xStore);
const nftxToken = new web3.eth.Contract(
  Erc20Contract.abi,
  "0x87d73e916d7057945c9bcd8cdd94e42a6f47f776"
);

app.get("/nftx-circulating-supply", async (_, res) => {
  const ignoreList = [
    "0x8f217d5cccd08fd9dce24d6d42aba2bb4ff4785b", // founder
    "0x40d73df4f99bae688ce3c23a01022224fe16c7b2", // dao
    "0x843d81eAF23c0073426581dE5a3735B060888f1b", // operations
  ];
  let supply = new bn(await nftxToken.methods.totalSupply().call());
  for (let i = 0; i < ignoreList.length; i++) {
    let amount = new bn(
      await nftxToken.methods.balanceOf(ignoreList[i]).call()
    );
    supply = supply.sub(amount);
  }
  res.send(web3.utils.fromWei(supply));
});

app.use(cors());
app.use(express.json());

app.use("/xcollection", xcollection);

app.listen(process.env.PORT || 5000);

//

setTimeout(async () => {
  // await dbClient.db("xdb").collection("xstore_event_chunks").deleteMany({});
  // await dbClient.db("xdb").collection("xstore_events").deleteMany({});
  cycleGetEventChunks(xStore, "xstore_event_chunks");
}, 3000);

//

const cycleGetEventChunks = async (contract, collectionName) => {
  const _collectionName = collectionName.split("_")[0] + "_events";
  console.log("cycleGetEventChunks", collectionName);
  const lastChunkArr = await dbClient
    .db("xdb")
    .collection(collectionName)
    .find()
    .project({ events: 0 })
    .sort({ startBlock: -1 })
    .limit(1)
    .toArray();
  let startBlock = null;
  if (lastChunkArr && lastChunkArr[0]) {
    const lastChunk = lastChunkArr[0];
    if (!lastChunk.doneSavingEvents) {
      console.log("deleting events...");
      await dbClient
        .db("xdb")
        .collection(_collectionName)
        .deleteMany({ blockNumber: { $gte: lastChunk.startBlock } });
      console.log("deleting event chunk...");
      await deleteFromCollection(collectionName, lastChunk);
    } else {
      const currentBlock = await web3.eth.getBlockNumber();
      const safetyBuffer = 1;
      if (lastChunk.endBlock < currentBlock - safetyBuffer) {
        startBlock = lastChunk.endBlock + 1;
      } else {
        startBlock = currentBlock - safetyBuffer - 1;
      }
    }
  } else if (Array.isArray(lastChunkArr) && lastChunkArr.length === 0) {
    startBlock = 11442000;
  }
  if (startBlock !== null) {
    const chunks = await fetchEventChunks(contract, startBlock);
    if (
      chunks.length === 1 &&
      chunks[0].events.length === 0 &&
      lastChunkArr[0]
    ) {
      await updateInCollection(collectionName, lastChunkArr[0], {
        endBlock: chunks[0].endBlock,
      });
    } else if (chunks.length > 0) {
      const newChunks = [];
      chunks.sort((a, b) => a.startBlock - b.startBlock);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (
          lastChunkArr.length > 0 &&
          chunk.startBlock <= lastChunkArr[0].endBlock
        ) {
          const newEvents = [];
          for (let _i; _i < chunk.events; _i++) {
            const event = chunk.events[_i];
            if (event.blockNumber <= lastChunkArr[0].endBlock) {
              if (!lastChunkArr[0].events.find((e) => e.id === event.id)) {
                console.log(
                  "TODO--add to previous chunk document and also to events collection"
                );
              }
            } else {
              newEvents.push(event);
            }
          }
          if (newEvents.length === 0) {
            if (chunk.endBlock > lastChunkArr[0].endBlock) {
              await updateInCollection(collectionName, lastChunkArr[0], {
                endBlock: chunk.endBlock,
              });
            }
            continue;
          }
          chunk.startBlock = lastChunkArr[0].endBlock + 1;
          chunk.events = newEvents;
        }
        chunk.doneSavingEvents = false;
        const receipt = await addToCollection(collectionName, chunk);
        console.log(receipt.insertedId);
        for (let j = 0; j < chunk.events.length; j++) {
          const event = chunk.events[j];
          await addToCollection(_collectionName, event);
          console.log(`(${i}, ${j})`);
        }
        await updateInCollection(
          collectionName,
          { _id: receipt.insertedId },
          { doneSavingEvents: true }
        );
      }
    }
  }
  setTimeout(() => {
    cycleGetEventChunks(contract, collectionName);
  }, 3000);
};

const fetchEventChunks = async (contract, initialBlock) => {
  const currentBlock = await web3.eth.getBlockNumber();
  let startBlock = initialBlock;
  let interval = 1024;
  let eventChunks = [];
  while (startBlock <= currentBlock) {
    interval *= 2;
    let events;
    let endBlock;
    while (!events) {
      endBlock =
        startBlock + interval > currentBlock
          ? currentBlock
          : startBlock + interval;
      try {
        events = await contract.getPastEvents("allEvents", {
          fromBlock: startBlock,
          toBlock: endBlock,
        });
      } catch (error) {
        if (error.message.includes("response size exceeded")) {
          if (interval <= 1) {
            throw "bottomed out";
          } else {
            interval /= 2;
          }
        } else {
          throw error;
        }
      }
    }
    console.log("new chunk", startBlock, endBlock, events.length);
    eventChunks.push({ startBlock, endBlock, events });
    startBlock = endBlock + 1;
  }

  return eventChunks;
};
