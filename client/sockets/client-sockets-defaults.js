/**
 * Created by ari on 9/19/2015.
 */


var protocol = self.location.protocol === 'https:' ? 'wss://' : 'ws://';
if(location.host) {
    ClientSockets.addURL(protocol + location.host.split(':')[0] + ':7314/socket');
}
ClientSockets.addURL(protocol + 'relayproject.net:7314/relay-server/socket');
ClientSockets.addURL(protocol + 'relaynode.us:7314/relay-server/socket');
ClientSockets.addURL(protocol + 'relay.co.il:7314/relay-server/socket');
