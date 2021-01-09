import cors from "cors";
import express from "express";
import Web3 from "web3";
import bn from "bn.js";

import NftxContract from "./contracts/NFTXv4.json";
import XStoreContract from "./contracts/XStore.json";
import Erc20Contract from "./contracts/ERC20.json";

import addresses from "./addresses/mainnet.json";

import xcollection from "./routes/xcollection";
import { addToXCollection, getXCollection, replaceInXCollection } from "./db";

const app = express();

// testing
app.get("/", (_, res) => {
  res.send("<h1>Hello from Express Server!</h1>");
});

const web3 = new Web3(
  "wss://eth-mainnet.ws.alchemyapi.io/v2/fL1uiXELcu8QeuLAxoCNmnbf_XuVlHBD"
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

setInterval(async () => {}, 5000);

// const cycle = async () => {
//   console.log("cycling...");
//   const collection = await getXCollection();
//   if (collection && collection[0]) {
//     const counter = parseInt(collection[0].counter);
//     console.log("new counter = ", counter);
//     replaceInXCollection(collection[0], { counter: counter + 1 });
//   }
//   setTimeout(() => {
//     cycle();
//   }, 5000);
// };

// const cycle = async () => {
//   console.log("cycling...");
//   const funds = [];
//   const numFunds = await xStore.methods.vaultsLength().call();
//   for (let i = 0; i < numFunds; i++) {
//     const fund = { vaultId: i };
//     fund.xTokenAddress = await xStore.methods.xTokenAddress(i).call();
//     fund.isD2Vault = await xStore.methods.isD2Vault(i).call();
//     if (fund.isD2Vault) {
//       fund.d2AssetAddress = await.xStore.methods.d2AssetAddress(i).call();
//     } else {
//       fund.nftAddress = await xStore.methods.
//     }
//   }
//   setTimeout(() => {
//     cycle();
//   }, 5000);
// };

const cycle = async () => {
  console.log("\ncycling...");
  const initialBlock = 11442000;
  const currentBlock = await web3.eth.getBlockNumber();
  let startBlock = initialBlock;
  let interval = 10240;
  const events = [];
  while (startBlock < currentBlock) {
    console.log("\ninside first while loop");
    if (interval < 10240) {
      interval *= 2;
      console.log("doubling interval to", interval);
    }
    let _events;
    while (!_events) {
      const endBlock = startBlock + interval;
      console.log("\ninside second while loop");
      try {
        _events = await xStore.getPastEvents("allEvents", {
          fromBlock: startBlock,
          toBlock: endBlock,
        });
        console.log("got _events, length = ", _events.length);
      } catch (error) {
        throw error;
        if (interval <= 1) {
          throw "bottomed out inside cycle()";
        } else {
          console.log(error.message);
          interval /= 2;
          console.log("dividing interval in half to", interval);
        }
      }
    }
    console.log("outside second while loop");
    events = events.concat(_events);
    startBlock = endBlock + 1;
  }
  console.log("outside first while loop");

  setTimeout(() => {
    cycle();
  }, 5000);
};

setTimeout(() => {
  cycle();
}, 5000);
