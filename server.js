import cors from "cors";
import express from "express";
import Web3 from "web3";

import NftxContract from "./contracts/NFTXv4.json";
import XStoreContract from "./contracts/XStore.json";
import Erc20Contract from "./contracts/ERC20.json";

import addresses from "./addresses/mainnet.json";

import scores from "./routes/scores";

const app = express();

// testing
app.get("/", (_, res) => {
  res.send("<h1>Hello from Express Server!</h1>");
});

const nftx = new web3.eth.Contract(NftxContract.abi, addresses.nftxProxy);
const xStore = new web3.eth.Contract(XStoreContract.abi, addresses.xStore);
const nftxToken = new web3.eth.Contract(
  Erc20Contract.abit,
  "0x87d73e916d7057945c9bcd8cdd94e42a6f47f776"
);

app.get("/nftx-circulating-supply", async (_, res) => {
  const ignoreList = [
    "0x8f217d5cccd08fd9dce24d6d42aba2bb4ff4785b", // founder
    "0x40d73df4f99bae688ce3c23a01022224fe16c7b2", // dao
    "0x843d81eAF23c0073426581dE5a3735B060888f1b", // operations
  ];
  let supply = await nftxToken.methods.totalSupply().call();
  for (let i = 0; i < ignoreList.length; i++) {
    supply -= await nftxToken.methods.balanceOf(ignoreList[i]).call();
  }
  return supply;
});

app.use(cors());
app.use(express.json());

app.use("/scores", scores);

app.listen(process.env.PORT || 5000);
