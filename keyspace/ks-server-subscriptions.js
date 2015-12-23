/**
 * Created by ari on 12/17/2015.
 */

"use strict";
if (!module) var module = {exports: {}};
if (typeof self === 'undefined')
    var self = this;
module.exports.KeySpaceServerSubscriptions =
    typeof self.KeySpaceServerSubscriptions !== 'undefined' ? self.KeySpaceServerSubscriptions :

(function() {
    function KeySpaceServerSubscriptions() {

    }

    var channels = {};
    KeySpaceServerSubscriptions.add = function(client, channel, mode, argString) {
        if(typeof channels[channel.toLowerCase()] === 'undefined')
            channels[channel.toLowerCase()] = {};
        var channelSubscriptions = channels[channel.toLowerCase()];

        if(typeof channelSubscriptions[mode.toLowerCase()] === 'undefined')
            channelSubscriptions[mode.toLowerCase()] = [];
        var channelModeSubscriptions = channelSubscriptions[mode.toLowerCase()];
        for(var i=0; i<channelModeSubscriptions.length; i++) {
            if(channelModeSubscriptions[i][0] === client) {
                if(channelModeSubscriptions[i][1] === argString)
                    return false;
                channelModeSubscriptions[i] = [client, argString];
                return true;
            }
        }
        channelModeSubscriptions.push([client, argString]);
        return true;
    };

    KeySpaceServerSubscriptions.remove = function(client, channel, mode) {
        if(typeof channels[channel.toLowerCase()] === 'undefined')
            return false;
        var channelSubscriptions = channels[channel.toLowerCase()];

        if(typeof channelSubscriptions[mode.toLowerCase()] === 'undefined')
            return false;
        var channelModeSubscriptions = channelSubscriptions[mode.toLowerCase()];
        for(var i=0; i<channelModeSubscriptions.length; i++) {
            if(channelModeSubscriptions[i][0] === client) {
                var argString = channelModeSubscriptions[i][1];
                channelModeSubscriptions.splice(i, 1);
                return argString;
            }
        }
        return false;
    };

    KeySpaceServerSubscriptions.getClients = function(channel, mode) {
        if(typeof channels[channel.toLowerCase()] === 'undefined')
            return [];
        var channelSubscriptions = channels[channel.toLowerCase()];

        if(typeof channelSubscriptions[mode.toLowerCase()] === 'undefined')
            return [];
        var channelModeSubscriptions = channelSubscriptions[mode.toLowerCase()];
        return channelModeSubscriptions.slice();
    };

    KeySpaceServerSubscriptions.getChannelClientSubscription = function(client, channel, mode) {
        if(typeof channels[channel.toLowerCase()] === 'undefined')
            return null;
        var channelSubscriptions = channels[channel.toLowerCase()];

        if(typeof channelSubscriptions[mode.toLowerCase()] === 'undefined')
            return null;
        var channelModeSubscriptions = channelSubscriptions[mode.toLowerCase()];
        for(var i=0; i<channelModeSubscriptions.length; i++) {
            if(channelModeSubscriptions[i][0] === client) {
                return channelModeSubscriptions[i][1];
            }
        }
        return null;
    };

    KeySpaceServerSubscriptions.getChannelClientSubscriptions = function(client, callback) {
        // TODO: inefficient?
        var count = 0;
        for(var channelName in channels) {
            if(channels.hasOwnProperty(channelName)) {
                var channelModes = channels[channelName];
                for(var channelMode in channelModes) {
                    if(channelModes.hasOwnProperty(channelMode)) {
                        var channelModeSubscriptions = channelModes[channelMode];
                        for(var i=0; i<channelModeSubscriptions.length; i++) {
                            if(client === channelModeSubscriptions[i][0]) {
                                callback(channelName, channelMode, channelModeSubscriptions[i][1]);
                            }
                        }
                    }
                }
            }
        }
        return count;
    };

    return KeySpaceServerSubscriptions;
})();