import cors from "cors";
import express from "express";
import Web3 from "web3";
import bn from "bn.js";

import dbClient from "./db/client";

import NftxContract from "./contracts/NFTXv4.json";
import XStoreContract from "./contracts/XStore.json";
import Erc20Contract from "./contracts/ERC20.json";
import XStoreMultiCallContract from "./contracts/XStoreMultiCall.json";
import TokenMultiCallContract from "./contracts/TokenMultiCall.json";

import addresses from "./addresses/mainnet.json";

const zeroAddress = "0x0000000000000000000000000000000000000000";

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
const xStoreMultiCall = new web3.eth.Contract(
  XStoreMultiCallContract.abi,
  addresses.xStoreMultiCall
);
const tokenMultiCall = new web3.eth.Contract(
  TokenMultiCallContract.abi,
  addresses.tokenMultiCall
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

app.get("/funds-data", async (_, res) => {
  const dbFundDataArr = await dbClient
    .db("xdb")
    .collection("funds")
    .find()
    .toArray();
  res.send(dbFundDataArr);
});

app.use(cors());
app.use(express.json());

app.use("/xcollection", xcollection);

app.listen(process.env.PORT || 5000);

const pendingChecks = [];

const addNewPendingCheck = (event) => {
  if (event.returnValues.vaultId) {
    const index = parseInt(event.returnValues.vaultId);
    if (!pendingChecks[index]) {
      pendingChecks[index] = Date.now();
    }
  }
};

const getOldestPendingCheck = () => {
  if (pendingChecks.length === 0) {
    return null;
  }
  const retVal = [];
  pendingChecks.forEach((elem, i) => {
    if (elem) {
      retVal.push(i);
    }
  });
  const { index } = retVal.reduce(
    (acc, elem, i) => {
      if (elem < acc.time) {
        return { index: i, time: elem };
      } else {
        return acc;
      }
    },
    { index: null, time: Date.now() * 2 }
  );
  return index;
};

const startCycle = () => {
  setTimeout(async () => {
    try {
      // await dbClient.db("xdb").collection("xstore_event_chunks").deleteMany({});
      // await dbClient.db("xdb").collection("xstore_events").deleteMany({});
      await cycleGetEventChunks(xStore, "xstore_event_chunks");
      console.log("Finished first xstore event cycle");
      // await dbClient.db("xdb").collection("nftx_event_chunks").deleteMany({});
      // await dbClient.db("xdb").collection("nftx_events").deleteMany({});
      await cycleGetEventChunks(nftx, "nftx_event_chunks");
      console.log("Finished first nftx event cycle");

      await dbClient.db("xdb").collection("funds").deleteMany({});
      const numFunds = parseInt(await xStore.methods.vaultsLength().call());
      if (numFunds > 0) {
        cycleGetFundData(0);
      }
    } catch (err) {
      console.log("top level error:", err.message);
      startCycle();
    }
  }, 3000);
};
startCycle();

const getFundDataHelper = async (index) => {
  console.log("getFundDataHelper", index);
  const fundData = await fetchFundData(index);
  const dbFundDataArr = await dbClient
    .db("xdb")
    .collection("funds")
    .find({ vaultId: { $eq: index } })
    .toArray();
  if (dbFundDataArr.length > 1) {
    dbFundDataArr.forEach((elem, i) => {
      if (i > 0) {
        deleteFromCollection("funds", elem);
      }
    });
  }
  if (dbFundDataArr.length === 0) {
    await addToCollection("funds", fundData);
    console.log("added fund " + fundData.vaultId + " data");
  } else {
    const dbFundData = dbFundDataArr[0];
    const updatedFundData = {};
    Object.keys(dbFundData).forEach((key) => {
      if (key !== "_id" && dbFundData[key] !== fundData[key]) {
        updatedFundData[key] = dbFundData[key];
      }
    });
    if (Object.keys(updatedFundData).length > 0) {
      await updateInCollection("funds", dbFundDataArr, updatedFundData);
      console.log("updated fund " + fundData.vaultId + " data");
    } else {
      console.log("fund data already up-to-date");
    }
  }
};

const getD1Holdings = async (index) => {
  const holdings = {};
  const dbXStoreEvents = await dbClient
    .db("xdb")
    .collection("xstore_events")
    .find({
      $and: [
        {
          $or: [
            { event: { $eq: "HoldingsAdded" } },
            { event: { $eq: "HoldingsRemoved" } },
          ],
        },
        { vaultId: { $eq: index } },
      ],
    })
    .sort({ blockNumber: 1, logIndex: 1 })
    .toArray();
  for (let i = 0; i < dbXStoreEvents.length; i++) {
    const event = dbXStoreEvents[i];
    holdings[event.returnValues.id] = event.event.includes("Added");
  }
  return Object.keys(holdings).filter((key) => holdings[key]);
};

const getD1Requests = async (index) => {
  const requests = {};
  const dbXStoreEvents = await dbClient
    .db("xdb")
    .collection("xstore_events")
    .find({
      $and: [{ event: { $eq: "RequesterSet" } }, { vaultId: { $eq: index } }],
    })
    .sort({ blockNumber: 1, logIndex: 1 })
    .toArray();
  for (let i = 0; i < dbXStoreEvents.length; i++) {
    const event = dbXStoreEvents[i];
    requests[event.returnValues.id] = event.returnValues.requester;
  }
  return Object.keys(requests).filter((key) => requests[key] != zeroAddress);
};

const getD1Eligibilities = async (index) => {
  const eligibilities = {};
  const dbXStoreEvents = await dbClient
    .db("xdb")
    .collection("xstore_events")
    .find({
      $and: [{ event: { $eq: "IsEligibleSet" } }, { vaultId: { $eq: index } }],
    })
    .sort({ blockNumber: 1, logIndex: 1 })
    .toArray();
  for (let i = 0; i < dbXStoreEvents.length; i++) {
    const event = dbXStoreEvents[i];
    eligibilities[event.returnValues.id] = event.returnValues._bool;
  }
  return Object.keys(eligibilities).filter((key) => eligibilities[key]);
};

const cycleGetFundData = async (index) => {
  console.log("cycleGetFundData", index);
  let oldestPendingCheck = getOldestPendingCheck();
  if (oldestPendingCheck !== null) {
    while (oldestPendingCheck !== null) {
      console.log("oldestPendingCheck", oldestPendingCheck);
      pendingChecks[index] = null;
      getFundDataHelper(oldestPendingCheck);
      oldestPendingCheck = getOldestPendingCheck();
    }
    await new Promise((resolve) => setTimeout(() => resolve(), 1000));
  }
  //
  await getFundDataHelper(index);
  //
  const numFunds = parseInt(await xStore.methods.vaultsLength().call());
  const newIndex = (index + 1) % numFunds;
  setTimeout(() => {
    cycleGetFundData(newIndex);
  }, 1000);
};

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
      console.log("deleting events...", collectionName);
      await dbClient
        .db("xdb")
        .collection(_collectionName)
        .deleteMany({ blockNumber: { $gte: lastChunk.startBlock } });
      console.log("deleting event chunk...", collectionName);
      await deleteFromCollection(collectionName, lastChunk);
    } else {
      const currentBlock = await web3.eth.getBlockNumber();
      const safetyBuffer = 2;
      if (lastChunk.endBlock <= currentBlock - safetyBuffer) {
        startBlock = lastChunk.endBlock + 1;
      } else {
        startBlock = currentBlock - safetyBuffer;
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
      // const newChunks = [];
      chunks.sort((a, b) => a.startBlock - b.startBlock);
      for (let i = 0; i < chunks.length; i++) {
        console.log("top of for-loop", collectionName);
        const chunk = chunks[i];
        if (lastChunkArr[0] && chunk.startBlock <= lastChunkArr[0].endBlock) {
          const oldChunkEventsToAdd = [];
          const newChunkEvents = [];
          for (let _i; _i < chunk.events; _i++) {
            const event = chunk.events[_i];
            if (event.blockNumber <= lastChunkArr[0].endBlock) {
              if (!lastChunkArr[0].events.find((e) => e.id === event.id)) {
                oldChunkEventsToAdd.push(event);
              }
            } else {
              newChunkEvents.push(event);
            }
          }
          if (oldChunkEventsToAdd.length > 0) {
            await updateInCollection(collectionName, lastChunkArr[0], {
              doneSavingEvents: false,
              events: lastChunkArr[0].events.concat(oldChunkEventsToAdd),
            });
            for (let j = 0; j < oldChunkEventsToAdd.length; j++) {
              const eventToAdd = oldChunkEventsToAdd[j];
              if (eventToAdd.returnValues.vaultId) {
                eventToAdd.vaultId = parseInt(eventToAdd.returnValues.vaultId);
              } else {
                eventToAdd.vaultId = null;
              }
              await addToCollection(_collectionName, event);
              addNewPendingCheck(eventToAdd);
              console.log(
                `added new event from prev chunk (${i}, ${j})`,
                collectionName
              );
            }
            await updateInCollection(collectionName, lastChunkArr[0], {
              doneSavingEvents: true,
            });
          }
          if (newChunkEvents.length === 0) {
            console.log("eventsToKeep is empty", collectionName);
            if (chunk.endBlock > lastChunkArr[0].endBlock) {
              await updateInCollection(collectionName, lastChunkArr[0], {
                endBlock: chunk.endBlock,
              });
              console.log(
                "updated lastChunk endBlock from",
                lastChunkArr[0].endBlock,
                " to",
                chunk.endBlock
              );
            }
            console.log("going to 'continue' now...", collectionName);
            continue;
          }
          chunk.startBlock = lastChunkArr[0].endBlock + 1;
          chunk.events = newChunkEvents;
        }
        chunk.doneSavingEvents = false;
        const receipt = await addToCollection(collectionName, chunk);
        console.log(
          "added chunk with startBlock",
          chunk.startBlock,
          " and endBlock",
          chunk.endBlock,
          collectionName
        );
        for (let j = 0; j < chunk.events.length; j++) {
          const event = chunk.events[j];
          if (event.returnValues.vaultId) {
            event.vaultId = parseInt(event.returnValues.vaultId);
          } else {
            event.vaultId = null;
          }
          await addToCollection(_collectionName, event);
          addNewPendingCheck(event);
          console.log(`added event (${i}, ${j})`, collectionName);
        }
        await updateInCollection(
          collectionName,
          { _id: receipt.insertedId },
          { doneSavingEvents: true }
        );
      }
      console.log("outside of for-loop", collectionName);
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
    console.log(
      "new chunk",
      startBlock,
      endBlock,
      events.length,
      Object.keys(addresses).find((key) => addresses[key] === contract._address)
    );
    eventChunks.push({ startBlock, endBlock, events });
    startBlock = endBlock + 1;
  }

  return eventChunks;
};

const fetchFundData = async (vaultId) => {
  const data = { vaultId: vaultId };
  const vaultDataA = await xStoreMultiCall.methods
    .getVaultDataA(vaultId)
    .call();
  const vaultDataB = await xStoreMultiCall.methods
    .getVaultDataB(vaultId)
    .call();
  // data.xTokenAddress = vaultDataA.xTokenAddress;
  // data.nftAddress = vaultDataA.nftAddress;
  data.manager = vaultDataA.manager;
  data.isClosed = vaultDataA.isClosed;
  data.isD2Vault = vaultDataA.isD2Vault;
  // data.d2AssetAddress = vaultDataA.d2AssetAddress;

  data.isFinalized = vaultDataB.isFinalized;

  if (data.isD2Vault) {
    const doubleErc20Data = await tokenMultiCall.methods
      .getDoubleErc20Data(vaultDataA.xTokenAddress, vaultDataA.d2AssetAddress)
      .call();
    data.fundToken = {
      address: vaultDataA.xTokenAddress,
      name: doubleErc20Data.name1,
      symbol: doubleErc20Data.symbol1,
      totalSupply: doubleErc20Data.totalSupply1,
    };
    data.asset = {
      address: vaultDataA.d2AssetAddress,
      name: doubleErc20Data.name2,
      symbol: doubleErc20Data.symbol2,
      totalSupply: doubleErc20Data.totalSupply2,
    };
  } else {
    data.allowMintRequests = vaultDataB.allowMintRequests;
    data.flipEligOnRedeem = vaultDataB.flipEligOnRedeem;
    data.negateEligibility = vaultDataB.negateEligibility;
    const erc20And721Data = await tokenMultiCall.methods
      .getErc20And721Data(vaultDataA.xTokenAddress, vaultDataA.nftAddress)
      .call();
    data.fundToken = {
      address: vaultDataA.xTokenAddress,
      name: erc20And721Data.erc20Name,
      symbol: erc20And721Data.erc20Symbol,
      totalSupply: erc20And721Data.erc20TotalSupply,
    };
    data.asset = {
      address: vaultDataA.nftAddress,
      name: erc20And721Data.erc721name,
      symbol: erc20And721Data.erc721symbol,
    };
    data.holdings = await getD1Holdings(vaultId);
    data.requests = await getD1Requests(vaultId);
    data.eligibilities = await getD1Eligibilities(vaultId);
  }

  return data;
};
