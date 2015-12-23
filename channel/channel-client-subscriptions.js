/**
 * Created by ari on 12/17/2015.
 */

"use strict";
if (!module) var module = {exports: {}};
if (typeof self === 'undefined')
    var self = this;
module.exports.ChannelClientSubscriptions =
    typeof self.ChannelClientSubscriptions !== 'undefined' ? self.ChannelClientSubscriptions :

(function() {

    function ChannelClientSubscriptions() {

    }

    var channels = {};

    ChannelClientSubscriptions.setChannelSubscriptionList = function(channel, mode, subscriptionList) {
        //subscriptionList = subscriptionList.filter(function (value, index, self) {
        //    return self.indexOf(value) === index;
        //}); // TODO: unique necessary?

        if(typeof channels[channel.toLowerCase()] === 'undefined')
            channels[channel.toLowerCase()] = {};
        var channelSubscriptions = channels[channel.toLowerCase()];
        if(typeof channelSubscriptions[mode.toLowerCase()] === 'undefined')
            channelSubscriptions[mode.toLowerCase()] = [];

        channelSubscriptions[mode.toLowerCase()] = subscriptionList;
    };

    ChannelClientSubscriptions.add = function(channel, mode, argString) {
        if(typeof channels[channel.toLowerCase()] === 'undefined')
            channels[channel.toLowerCase()] = {};
        var channelSubscriptions = channels[channel.toLowerCase()];
        if(typeof channelSubscriptions[mode.toLowerCase()] === 'undefined')
            channelSubscriptions[mode.toLowerCase()] = [];
        var channelModeSubscriptions = channelSubscriptions[mode.toLowerCase()];
        if(channelModeSubscriptions.indexOf(argString) === 0)
            return false;
        channelModeSubscriptions.push(argString);
        return true;
    };

    ChannelClientSubscriptions.replace = function(channel, mode, argString) {
        var split = argString.split(' ');
        var oldArgStringPrefix = split.shift();
        argString = split.join(' ');

        if(typeof channels[channel.toLowerCase()] === 'undefined')
            throw new Error("Failed to replace. No such channel: " + channel);
        var channelSubscriptions = channels[channel.toLowerCase()];
        if(typeof channelSubscriptions[mode.toLowerCase()] === 'undefined')
            throw new Error("Failed to replace. No such channel/mode: " + channel + " " + mode);
        var channelModeSubscriptions = channelSubscriptions[mode.toLowerCase()];
        var pos = channelModeSubscriptions.indexOf(oldArgStringPrefix);
        if(pos === -1)
            throw new Error("Failed to replace. Old subscription prefix not found: " + oldArgStringPrefix);
        channelModeSubscriptions[pos] = argString;
        return true;
    };

    ChannelClientSubscriptions.remove = function(channel, mode, argString) {
        if(typeof channels[channel.toLowerCase()] === 'undefined')
            return false;
        var channelSubscriptions = channels[channel.toLowerCase()];
        if(typeof channelSubscriptions[mode.toLowerCase()] === 'undefined')
            return false;
        var channelModeSubscriptions = channelSubscriptions[mode.toLowerCase()];
        var pos = channelModeSubscriptions.indexOf(argString);
        if(pos === -1)
            return false;
        channelModeSubscriptions.splice(pos, 1);
        return true;
    };

    ChannelClientSubscriptions.getClients = function(channel, mode) {
        if(typeof channels[channel.toLowerCase()] === 'undefined')
            return [];
        var channelSubscriptions = channels[channel.toLowerCase()];
        if(typeof channelSubscriptions[mode.toLowerCase()] === 'undefined')
            return [];
        var channelModeSubscriptions = channelSubscriptions[mode.toLowerCase()];
        return channelModeSubscriptions.slice();
    };

    ChannelClientSubscriptions.getChannelClientSubscription = function(channel, mode, argPrefix) {
        if(typeof channels[channel.toLowerCase()] === 'undefined')
            return null;
        var channelSubscriptions = channels[channel.toLowerCase()];
        if(typeof channelSubscriptions[mode.toLowerCase()] === 'undefined')
            return null;
        var channelModeSubscriptions = channelSubscriptions[mode.toLowerCase()];
        for(var i=0; i<channelModeSubscriptions.length; i++) {
            if(channelModeSubscriptions[i].indexOf(argPrefix) === 0) {
                return channelModeSubscriptions[i];
            }
        }
        return null;
    };

    ChannelClientSubscriptions.getChannelClientSubscriptions = function(callback) {
        // TODO: inefficient?
        var count = 0;
        for(var channelName in channels) {
            if(channels.hasOwnProperty(channelName)) {
                var channelModes = channels[channelName];
                for(var channelMode in channelModes) {
                    if(channelModes.hasOwnProperty(channelMode)) {
                        var channelModeSubscriptions = channelModes[channelMode];
                        for(var i=0; i<channelModeSubscriptions.length; i++) {
                            callback(channelName, channelMode, channelModeSubscriptions[i]);
                        }
                    }
                }
            }
        }
        return count;
    };

    return ChannelClientSubscriptions;
})();