/*
 * Copyright (C) 2017 Luigi Martinelli <luigi@xdefcon.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * @author Luigi Martinelli <luigi@xdefcon.com>
 *
 */


registerPlugin({
    name: 'AntiProxy - VPN/Proxy Blocker',
    version: '1.1',
    description: 'With this script trolls and spammers will become the last problem for your TeamSpeak server, you ban them, they use a VPN or a proxy to reconnect and they can not!',
    author: 'Luigi M. -  xDefcon (luigi@xdefcon.com)',
    vars: {
        enableSwitch: {
            title: 'Activate the script?',
            type: 'select',
            options: ['no', 'yes']
        }, debugSwitch: {
            title: 'Enable debug messages?',
            type: 'select',
            options: ['no', 'yes']
        }, punishment: {
            title: 'Punishment when a proxy is detected',
            type: 'select',
            options: ['poke', 'kick', 'tempban']
        }, tempBanDuration: {
            title: "Temp ban duration in seconds",
            type: 'number',
            conditions: [{field: 'punishment', value: 2}]
        }, punishmentMessage: {
            title: "Punishment message (kick, poke, ban)",
            type: 'string',
            placeholder: "Proxy/VPN detected. Error? Contact: luigi@xdefcon.com or admin"
        }, notifyOnDetection: {
            title: 'Notify Admins when a proxy is detected?',
            type: 'select',
            options: ['no', 'yes']
        }, permissionsMessage: {
            title: "Not enough permissions message",
            type: 'string',
            placeholder: "You don't have enough permissions to execute this command."
        }, admins: {
            title: "Admin Unique IDs used to send important notifications",
            type: "array",
            vars: [{
                name: 'adminUID',
                indent: 1,
                title: 'Admin Client UID',
                type: 'string'
            }]
        }, adminGroups: {
            title: "Admin Group IDs used to send important notifications",
            type: "array",
            vars: [{
                name: 'groupID',
                indent: 1,
                title: 'Admin Group ID',
                type: 'number'
            }]
        }, whitelist: {
            title: "Whitelist of IP addresses (Please report to lugi@xdefcon.com if false detection, this is a quick fix.)",
            type: "array",
            vars: [{
                name: "address",
                indent: 1,
                title: "Client IP address to whitelist",
                type: "string"
            }]
        }
    }
}, function (sinusbot, config) {
    if (typeof config.enableSwitch == 'undefined') {
        config.enableSwitch = 1;
    }
    if (typeof config.debugSwitch == 'undefined') {
        config.debugSwitch = 0;
    }
    if (typeof config.punishment == 'undefined') {
        config.punishment = 1;
    }
    if (typeof config.punishmentMessage == 'undefined' || config.punishmentMessage == "") {
        config.punishmentMessage = "Proxy/VPN detected. Error? Contact: luigi@xdefcon.com or admin";
    }
    if (typeof config.notifyOnDetection == 'undefined') {
        config.notifyOnDetection = 1;
    }
    if (typeof config.permissionsMessage == 'undefined') {
        config.permissionsMessage = "You don't have enough permissions to execute this command.";
    }
    if (config.punishment == 2 && typeof config.tempBanDuration == 'undefined') {
        config.tempBanDuration = 10;
    }
    if (typeof config.adminGroups == 'undefined') {
        config.adminGroups = [];
    }
    if (typeof config.admins == 'undefined') {
        config.admins = [];
    }
    if (typeof config.whitelist == 'undefined') {
        config.whitelist = [];
    }

    var event = require("event");
    var engine = require("engine");
    var backend = require("backend");
    var localProxies = {};
    var rateLimited = false;

    var startedTime = config.enableSwitch == 1 ? Date.now() : null;
    var checkedIps = 0;
    var detectedProxies = 0;
    var apiRequests = 0;
    var lastDetection = {
        client: null,
        ip: null
    };

    setInterval(function() {
        debug("Executing automatic purge of the local IP cache.");
        localProxies = {};
    }, 86400000);


    event.on("chat", function (ev) {
        var message = ev.text;
        var client = ev.client;
        if (client.isSelf()) {
            return;
        }

        switch (message) {
            case "!antiproxy enable":
                if (!checkPermissions(client)) {
                    client.chat(config.permissionsMessage);
                    return;
                }
                if (config.enableSwitch == 0) {
                    config.enableSwitch = 1;
                    startedTime = Date.now();
                    rateLimited = false;
                    client.chat("Successfully enabled AntiProxy script.");
                    debug("Enabling script by command.");
                } else {
                    client.chat("The script is already enabled, type '!antiproxy disable' to disable it.");
                }
                break;
            case "!antiproxy disable":
                if (!checkPermissions(client)) {
                    client.chat(config.permissionsMessage);
                    return;
                }
                if (config.enableSwitch == 1) {
                    config.enableSwitch = 0;
                    startedTime = null;
                    client.chat("Successfully disabled AntiProxy script.");
                    debug("Disabling script by command.");
                } else {
                    client.chat("The script is already disabled, type '!antiproxy enable' to enable it.");
                }
                break;
            case "!antiproxy info":
                if (!checkPermissions(client)) {
                    client.chat(config.permissionsMessage);
                    return;
                }
                client.chat("\n[b]AntiProxy by xDefcon[/b]\n" +
                    "[b]Running time[/b]: " + ((Date.now() - startedTime) / 1000).toString() + "secs\n" +
                    "[b]Proxies detected[/b]: " + detectedProxies + "\n" +
                    "[b]Last detection[/b]: " + lastDetection.client + " " + lastDetection.ip + "\n" +
                    "[b]Checked IPs[/b]: " + checkedIps + "\n" +
                    "[b]IP cached locally[/b]: " + Object.keys(localProxies).length + "\n" +
                    "[b]API requests[/b]: " + apiRequests + "\n");
                break;
            case "!antiproxy purgecache":
                if (!checkPermissions(client)) {
                    client.chat(config.permissionsMessage);
                    return;
                }
                localProxies = {};
                client.chat("Successfully purged the local IP cache.");
                break;
            case "!antiproxy checkall":
                if (!checkPermissions(client)) {
                    client.chat(config.permissionsMessage);
                    return;
                }
                checkAllClients();
                client.chat("Checking all clients now connected to the TeamSpeak server.");
                break;
        }
    });


    event.on("clientIPAddress", function (client) {
        if (config.enableSwitch == 0) {
            return;
        }
        if (client.isSelf()) {
            return;
        }
        debug("Fired clientIPAddress - Client: " + client.name() + " [" + client.getIPAddress() + "].");
        checkForProxy(client);
    });


    function checkPermissions(client) {
        var check = false;
        for (var i = 0; i < config.admins.length; i++) {
            if (config.admins[i].adminUID == client.uniqueID()) {
                check = true;
                break;
            }
        }
        if (!check) {
            var clientGroups = [];
            var serverGroups = client.getServerGroups();
            for (var j = 0; j < serverGroups.length; j++) {
                clientGroups[j] = "" + serverGroups[j].id();
            }
            for (i = 0; i < config.adminGroups.length; i++) {
                if (clientGroups.indexOf("" + config.adminGroups[i].groupID) !== -1) {
                    check = true;
                    break;
                }
            }
        }
        return check;
    }


    function sendMessageToStaff(msg) {
        backend.getClients().forEach(function(client) {
            if (checkPermissions(client)) {
                client.chat(msg);
            }
        });

    }


    function checkAllClients() {
        debug("Running proxy check on all clients.");
        backend.getClients().forEach(function(client) {
            if (client.isSelf()) {
                return;
            }
            checkForProxy(client);
        });
    }


    function checkForProxy(client) {
        var ip = client.getIPAddress();
        var res = checkProxyViaAPI(ip, client);
        if (res === true) {
            debug("[PROXY DETECTED] Client: " + client.name() + " (" + client.uniqueID() + ") IP: " + ip);
            handleDetection(client);
        } else if (res === false) {
            debug("Passing proxy check for Client: " + client.name() + " - IP: " + ip);
        } else {
            debug("Waiting API response for Client: " + client.name() + " - IP: " + ip);
        }
    }


    function checkProxyViaAPI(ip, client) {
        ++checkedIps;

        var WhitelistException = {};
        try {
            config.whitelist.forEach(function (val) {
                if (typeof val.address != "undefined") {
                    if ("" + ip == val.address) {
                        debug("[WHITELIST] Detected IP in whitelist. Skipping check for: " + ip);
                        throw WhitelistException;
                        return false;
                    }
                }
            });
        } catch (e) {
            if (e == WhitelistException) {
                return false;
            }
        }

        if (localProxies[ip] != null && localProxies[ip]) {
            debug("[CACHE] The IP is present in local cache and resulted in a Proxy.");
            return true;
        } else if (localProxies[ip] != null && !localProxies[ip]) {
            debug("[CACHE] The IP is present in local cache and resulted in a clean address.");
            return false;
        }

        var httpOp = {
            method: "GET",
            headers: "Content-type: application/json",
            timeout: 4500,
            url: "https://api.xdefcon.com/proxy/check/?ip=" + ip
        };
        sinusbot.http(httpOp, function (error, response) {
            ++apiRequests;
            if (response.statusCode !== 200) {
                engine.log("Could not retrieve info for " + ip + " HTTP_ERROR: " + error);
                return false;
            }
            debug("RESPONSE: " + response.data);
            var result = JSON.parse(response.data);
            if (result.success && result.proxy != null) {
                rateLimited = false;
                if (result.proxy.valueOf()) {
                    localProxies[ip] = true;
                    handleDetection(client);
                    return true;
                } else {
                    localProxies[ip] = false;
                    return false;
                }
            } else if (!result.success && result.message.toLowerCase().indexOf("rate limit") !== -1) {
                engine.log("[ERROR] API requests limit exceeded, please contact luigi@xdefcon.com to remove this limitation.");
                if (!rateLimited) {
                    rateLimited = true;
                    sendMessageToStaff("[b][AntiProxy][/b] It seems that you have [b]exceeded[/b] the maximum hourly rate of [b]requests to the API[/b]. " +
                        "This means that you will not be able to check [b]new IPs[/b] until the next hour (rate limit reset). If you want to " +
                        "avoid this problem, please consider contacting the developer & provider of the API via email at: " +
                        "[b][url=mailto:lugi@xdefcon.com?subject=Proxy%20API%20rate%20limit]luigi@xdefcon.com[/url][/b] - " +
                        "The script [b]will continue working with the local cache[/b], no issues about it.");
                }
                return false;
            }
            debug("Error in the API response. Is the API offline? Using cached data. URL: " + httpOp.url);
            return false;

        })
    }


    function handleDetection(client) {
        ++detectedProxies;
        lastDetection.client = client.name() + "(" + client.uniqueID() + ")";
        lastDetection.ip = client.getIPAddress();

        if (config.notifyOnDetection == 1) {
            sendMessageToStaff("[b][AntiProxy][/b] Detected Proxy on client: " + client.name() + "(" + client.uniqueID() + ") IP: " + client.getIPAddress());
        }
        debug("Punishment message: " + config.punishmentMessage);
        if (config.punishment == 0) {
            client.poke(config.punishmentMessage);
            debug("Sent poke to Client: " + client.name());
        }
        if (config.punishment == 1) {
            client.kick(config.punishmentMessage);
            debug("Kicked Client: " + client.name());
        }
        if (config.punishment == 2) {
            client.ban(config.tempBanDuration, config.punishmentMessage.substring(0, 70));
            debug("Tempbanned Client: " + client.name() + " for " + config.tempBanDuration + " seconds.");
        }
    }


    function debug(msg) {
        if (config.debugSwitch == 1) {
            engine.log("[DEBUG] " + msg);
        }
    }
});
