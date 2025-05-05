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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
var _a, _b, _c, _d;
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const fs = __importStar(require("fs"));
const path_1 = __importDefault(require("path"));
const TS_CLIENT_ID = (_a = process.env.TS_CLIENT_ID) !== null && _a !== void 0 ? _a : "";
const TS_CLIENT_SECRET = (_b = process.env.TS_CLIENT_SECRET) !== null && _b !== void 0 ? _b : "";
const DERP_PORT = +((_c = process.env.DERP_PORT) !== null && _c !== void 0 ? _c : "");
const STUN_PORT = +((_d = process.env.STUN_PORT) !== null && _d !== void 0 ? _d : "");
const DERP_DOMAIN = process.env.DERP_DOMAIN;
const HTTP_TIMEOUT = 5000;
function getIpV4Address() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const response = yield axios_1.default.get("https://ipv4.seeip.org", {
                timeout: HTTP_TIMEOUT,
            });
            return response.data;
        }
        catch (e) {
            console.error("Error getting IPv4 address:", e);
            return null;
        }
    });
}
function getIpV6Address() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const response = yield axios_1.default.get("https://ipv6.seeip.org", {
                timeout: HTTP_TIMEOUT,
            });
            return response.data;
        }
        catch (e) {
            console.error("Error getting IPv6 address:", e);
            return null;
        }
    });
}
function updateTailscaleAcl(domainPrefix, ipv4, ipv6) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const tokenResponse = yield axios_1.default.post("https://api.tailscale.com/api/v2/oauth/token", `client_id=${TS_CLIENT_ID}&client_secret=${TS_CLIENT_SECRET}`, {
            timeout: HTTP_TIMEOUT,
        });
        console.log(tokenResponse.data.access_token);
        const access_token = tokenResponse.data.access_token;
        const acl = (yield axios_1.default.request({
            method: "GET",
            url: "https://api.tailscale.com/api/v2/tailnet/handgrip.github/acl",
            headers: { Authorization: `Bearer ${access_token}` },
            timeout: HTTP_TIMEOUT,
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
                    IPv4: ipv4 ? ipv4 : null,
                    IPv6: ipv6 ? ipv6 : null,
                },
            ],
        };
        acl.derpMap.Regions = newRegions;
        const latestAcl = (yield axios_1.default.request({
            method: "POST",
            url: "https://api.tailscale.com/api/v2/tailnet/handgrip.github/acl",
            headers: { Authorization: `Bearer ${access_token}` },
            data: acl,
            timeout: HTTP_TIMEOUT,
        })).data;
        console.log(JSON.stringify(latestAcl));
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
User=ecs-user
# 总是自动重新启动
Restart=always
# 重启前等待5秒
RestartSec=5
# 启动derper的命令，跟上面测试用的命令一样
ExecStart=/home/ecs-user/go/bin/derper -hostname ${domainPrefix}.${DERP_DOMAIN} -a :${DERP_PORT} --http-port -1 -certmode manual -certdir /home/ecs-user/derper/ssl/ -c /home/ecs-user/derper/derper.conf -stun-port ${STUN_PORT}
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
        var _a, _b;
        const ipv4 = (_a = (yield getIpV4Address())) !== null && _a !== void 0 ? _a : "";
        const ipv6 = (_b = (yield getIpV6Address())) !== null && _b !== void 0 ? _b : "";
        const domainPrefix = "auto-derp-" + ipv4.replace(/\./g, "-");
        console.log("IPv4:", ipv4);
        console.log("IPv6:", ipv6);
        console.log("Domain Prefix:", domainPrefix);
        yield updateTailscaleAcl(domainPrefix, ipv4, ipv6);
        writeServiceFile(domainPrefix);
        writeDomainPrefix(domainPrefix);
    });
}
main();
//# sourceMappingURL=derper-update.js.map