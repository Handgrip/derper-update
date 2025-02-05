import axios from "axios";
import Cloudflare from "cloudflare";
import * as fs from "fs";
import path from "path";

const CF_ZONE_ID = process.env.CF_ZONE_ID ?? "";
const CF_TOKEN = process.env.CF_TOKEN ?? "";
const TS_CLIENT_ID = process.env.TS_CLIENT_ID ?? "";
const TS_CLIENT_SECRET = process.env.TS_CLIENT_SECRET ?? "";
const DERP_PORT = +(process.env.DERP_PORT ?? "");
const STUN_PORT = +(process.env.STUN_PORT ?? "");
const DERP_DOMAIN = process.env.DERP_DOMAIN;

const client = new Cloudflare({
    apiToken: CF_TOKEN,
});

async function getIpAddress() {
    const response = await axios.get("https://api.ipify.org?format=json");
    return response.data.ip;
}

async function updateTailscaleAcl(domainPrefix: string) {
    const tokenResponse = await axios.post(
        "https://api.tailscale.com/api/v2/oauth/token",
        `client_id=${TS_CLIENT_ID}&client_secret=${TS_CLIENT_SECRET}`
    );
    console.log(tokenResponse.data.access_token);
    const access_token = tokenResponse.data.access_token;

    const acl = (
        await axios.request({
            method: "GET",
            url: "https://api.tailscale.com/api/v2/tailnet/handgrip.github/acl",
            headers: { Authorization: `Bearer ${access_token}` },
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
        })
    ).data;
    console.log(JSON.stringify(latestAcl));
}

async function createSelfIpRecord(domainPrefix: string, ip: any) {
    await client.dns.records.create({
        type: "A",
        zone_id: CF_ZONE_ID,
        name: domainPrefix,
        content: ip,
        proxied: false,
        ttl: 60,
    });
    console.log("Updated DNS record for", domainPrefix, "to", ip);
}

async function removeExistRecord() {
    const dnsRecords = await client.dns.records.list({
        zone_id: CF_ZONE_ID,
        name: {
            startswith: "auto-derp",
        },
        type: "A",
    });
    // remove all records
    for (const record of dnsRecords.result) {
        await client.dns.records.delete(record.id, {
            zone_id: CF_ZONE_ID,
        });
        console.log("Deleted DNS record for", record.name);
    }
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
    await removeExistRecord();
    const ip = await getIpAddress();
    const domainPrefix = "auto-derp-" + ip.replace(/\./g, "-");
    await createSelfIpRecord(domainPrefix, ip);
    // sleep 5 seconds to wait for DNS to propagate
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await updateTailscaleAcl(domainPrefix);
    writeServiceFile(domainPrefix);
    writeDomainPrefix(domainPrefix);
}

main();
