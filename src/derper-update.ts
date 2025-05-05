import axios from "axios";
import * as fs from "fs";
import path from "path";

const TS_CLIENT_ID = process.env.TS_CLIENT_ID ?? "";
const TS_CLIENT_SECRET = process.env.TS_CLIENT_SECRET ?? "";
const DERP_PORT = +(process.env.DERP_PORT ?? "");
const STUN_PORT = +(process.env.STUN_PORT ?? "");
const DERP_DOMAIN = process.env.DERP_DOMAIN;
const HTTP_TIMEOUT = 5000;

async function getIpV4Address() {
    try {
        const response = await axios.get("https://ipv4.seeip.org", {
            timeout: HTTP_TIMEOUT,
        });
        return response.data;
    } catch (e) {
        console.error("Error getting IPv4 address:", e);
        return null;
    }
}

async function getIpV6Address() {
    try {
        const response = await axios.get("https://ipv6.seeip.org", {
            timeout: HTTP_TIMEOUT,
        });
        return response.data;
    } catch (e) {
        console.error("Error getting IPv6 address:", e);
        return null;
    }
}

async function updateTailscaleAcl(
    domainPrefix: string,
    ipv4: string,
    ipv6: string
) {
    const tokenResponse = await axios.post(
        "https://api.tailscale.com/api/v2/oauth/token",
        `client_id=${TS_CLIENT_ID}&client_secret=${TS_CLIENT_SECRET}`,
        {
            timeout: HTTP_TIMEOUT,
        }
    );
    console.log(tokenResponse.data.access_token);
    const access_token = tokenResponse.data.access_token;

    const acl = (
        await axios.request({
            method: "GET",
            url: "https://api.tailscale.com/api/v2/tailnet/handgrip.github/acl",
            headers: { Authorization: `Bearer ${access_token}` },
            timeout: HTTP_TIMEOUT,
        })
    ).data;

    const newRegions: Record<string, any> = {};
    for (const regionSlug in acl.derpMap.Regions) {
        const region = acl.derpMap.Regions[regionSlug];
        if (region?.RegionName?.startsWith("auto-derp-")) {
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
    const latestAcl = (
        await axios.request({
            method: "POST",
            url: "https://api.tailscale.com/api/v2/tailnet/handgrip.github/acl",
            headers: { Authorization: `Bearer ${access_token}` },
            data: acl,
            timeout: HTTP_TIMEOUT,
        })
    ).data;
    console.log(JSON.stringify(latestAcl));
}

function writeServiceFile(domainPrefix: string) {
    fs.writeFileSync(
        path.join(process.env.HOME ?? "/", "derper", "derper.service"),
        `[Unit]
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
`
    );
}

function writeDomainPrefix(domainPrefix: string) {
    fs.writeFileSync(
        path.join(process.env.HOME ?? "/", "derper", "domainPrefix.txt"),
        domainPrefix
    );
}

async function main() {
    const ipv4 = await getIpV4Address();
    const ipv6 = await getIpV6Address();
    const domainPrefix = "auto-derp-" + ipv4.replace(/\./g, "-");
    console.log("IPv4:", ipv4);
    console.log("IPv6:", ipv6);
    console.log("Domain Prefix:", domainPrefix);
    await updateTailscaleAcl(domainPrefix, ipv4, ipv6);
    writeServiceFile(domainPrefix);
    writeDomainPrefix(domainPrefix);
}

main();
