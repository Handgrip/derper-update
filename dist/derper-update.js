"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a, _b, _c, _d, _e, _f;
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const cloudflare_1 = __importDefault(require("cloudflare"));
const fs = __importStar(require("fs"));
const path_1 = __importDefault(require("path"));
const CF_ZONE_ID = (_a = process.env.CF_ZONE_ID) !== null && _a !== void 0 ? _a : "";
const CF_TOKEN = (_b = process.env.CF_TOKEN) !== null && _b !== void 0 ? _b : "";
const TS_CLIENT_ID = (_c = process.env.TS_CLIENT_ID) !== null && _c !== void 0 ? _c : "";
const TS_CLIENT_SECRET = (_d = process.env.TS_CLIENT_SECRET) !== null && _d !== void 0 ? _d : "";
const DERP_PORT = +((_e = process.env.DERP_PORT) !== null && _e !== void 0 ? _e : "");
const STUN_PORT = +((_f = process.env.STUN_PORT) !== null && _f !== void 0 ? _f : "");
const DERP_DOMAIN = process.env.DERP_DOMAIN;
const client = new cloudflare_1.default({
    apiToken: CF_TOKEN,
});
function getIpAddress() {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield axios_1.default.get("https://api.ipify.org?format=json");
        return response.data.ip;
    });
}
function updateTailscaleAcl(domainPrefix) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const tokenResponse = yield axios_1.default.post("https://api.tailscale.com/api/v2/oauth/token", `client_id=${TS_CLIENT_ID}&client_secret=${TS_CLIENT_SECRET}`);
        console.log(tokenResponse.data.access_token);
        const access_token = tokenResponse.data.access_token;
        const acl = (yield axios_1.default.request({
            method: "GET",
            url: "https://api.tailscale.com/api/v2/tailnet/handgrip.github/acl",
            headers: { Authorization: `Bearer ${access_token}` },
        })).data;
        const newRegions = {};
        for (const regionSlug in acl.derpMap.Regions) {
            const region = acl.derpMap.Regions[regionSlug];
            if ((_a = region === null || region === void 0 ? void 0 : region.RegionName) === null || _a === void 0 ? void 0 : _a.startsWith("auto-derp-")) {
                continue;
            }
            newRegions[regionSlug] = region;
        }
        let maxRegionID = 0;
        for (const regionSlug in newRegions) {
            maxRegionID = Math.max(maxRegionID, +regionSlug);
        }
        const addRegionId = maxRegionID + 1;
        newRegions["" + addRegionId] = {
            RegionID: addRegionId,
            RegionCode: domainPrefix,
            RegionName: domainPrefix,
            Nodes: [
                {
                    Name: domainPrefix,
                    RegionID: addRegionId,
                    HostName: `${domainPrefix}.${DERP_DOMAIN}`,
                    CanPort80: false,
                    InsecureForTests: true,
                    DERPPort: DERP_PORT,
                    STUNPort: STUN_PORT,
                },
            ],
        };
        acl.derpMap.Regions = newRegions;
        const latestAcl = (yield axios_1.default.request({
            method: "POST",
            url: "https://api.tailscale.com/api/v2/tailnet/handgrip.github/acl",
            headers: { Authorization: `Bearer ${access_token}` },
            data: acl,
        })).data;
        console.log(JSON.stringify(latestAcl));
    });
}
function createSelfIpRecord(domainPrefix, ip) {
    return __awaiter(this, void 0, void 0, function* () {
        yield client.dns.records.create({
            type: "A",
            zone_id: CF_ZONE_ID,
            name: domainPrefix,
            content: ip,
            proxied: false,
            ttl: 60,
        });
        console.log("Updated DNS record for", domainPrefix, "to", ip);
    });
}
function removeExistRecord() {
    return __awaiter(this, void 0, void 0, function* () {
        const dnsRecords = yield client.dns.records.list({
            zone_id: CF_ZONE_ID,
            name: {
                startswith: "auto-derp",
            },
            type: "A",
        });
        for (const record of dnsRecords.result) {
            yield client.dns.records.delete(record.id, {
                zone_id: CF_ZONE_ID,
            });
            console.log("Deleted DNS record for", record.name);
        }
    });
}
function writeServiceFile(domainPrefix) {
    var _a;
    fs.writeFileSync(path_1.default.join((_a = process.env.HOME) !== null && _a !== void 0 ? _a : "/", "derper", "derper.service"), `[Unit]
# 服务名字
Description=Tailscale DERP Server
# 在网络服务启动后启动这个服务
After=network.target

[Service]
# 改成你的用户名
User=${process.env.USER}
# 总是自动重新启动
Restart=always
# 重启前等待5秒
RestartSec=5
# 启动derper的命令，跟上面测试用的命令一样
ExecStart=/home/${process.env.USER}/go/bin/derper -hostname ${domainPrefix}.${DERP_DOMAIN} -a :${DERP_PORT} --http-port -1 -certmode manual -certdir /home/${process.env.USER}/derper/ssl/ -c /home/${process.env.USER}/derper/derper.conf -stun-port ${STUN_PORT}
# 停止derper的命令
ExecStop=/bin/kill $MAINPID

[Install]
WantedBy=multi-user.target
`);
}
function writeDomainPrefix(domainPrefix) {
    var _a;
    fs.writeFileSync(path_1.default.join((_a = process.env.HOME) !== null && _a !== void 0 ? _a : "/", "derper", "domainPrefix.txt"), domainPrefix);
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        yield removeExistRecord();
        const ip = yield getIpAddress();
        const domainPrefix = "auto-derp-" + ip.replace(/\./g, "-");
        yield createSelfIpRecord(domainPrefix, ip);
        yield new Promise((resolve) => setTimeout(resolve, 5000));
        yield updateTailscaleAcl(domainPrefix);
        writeServiceFile(domainPrefix);
        writeDomainPrefix(domainPrefix);
    });
}
main();
//# sourceMappingURL=derper-update.js.map