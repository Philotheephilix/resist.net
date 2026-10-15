import { ethers } from "ethers";
import fs from "fs";
import path from "path";

const CONFIG_PATH = path.join(process.env.HOME || "~", ".resist-net", "config.json");

export function loadConfig() {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });

  if (!fs.existsSync(CONFIG_PATH)) {
    const wallet = ethers.Wallet.createRandom();
    const config = {
      wallet: wallet.address,
      privateKey: wallet.privateKey,
      geohash: process.env.GEOHASH || "ttnnm77", // default: Mumbai
      isp: process.env.ISP || "unknown",
      prevHash: "0".repeat(64),
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    return config;
  }

  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}
