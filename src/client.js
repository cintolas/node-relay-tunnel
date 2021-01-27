const http = require('http');
const https = require('https');
const socketClient = require('socket.io-client');
const WebSocket = require('ws');
const EventSource = require('eventsource');

module.exports = class Client {
    options = {
        connect: () => {},
        hold: () => {},
        back: () => {},
        error: () => {},
        disconnect: () => {},
    };
    wsMap = new Map();
    resMap = new Map();
    constructor(localUrl, remoteUrl, options) {
        this.localUrl = localUrl;
        this.remoteUrl = remoteUrl;
        Object.assign(this.options, options); 
    }
    connect(socketOptions = {}) {
        let u = new URL(this.remoteUrl);
        let relayUrl = ['ws', u.protocol.startsWith('https') ? 's' :'', '://', u.host ].join('');

        socketOptions.rejectUnauthorized = false;
        let relaySocket = socketClient(relayUrl, socketOptions);
        this._general(relaySocket);
        this._websocket(relaySocket);
        this._request(relaySocket);
    }
    _general(relaySocket) {
        relaySocket.on('connect', () => {
            this.options.connect();
            relaySocket.emit('client', { 
                meta: this.options.meta
             });
        });
        relaySocket.on('hold', () => {
            this.options.hold();
            // console.log('[NLT] New client online, Sorry I have to put you on hold...')
        });
        relaySocket.on('back', () => {
            this.options.back();
            //console.log('[NLT] You are back online, ready to handle remote requests')
        });
        relaySocket.on('disconnect', (reason) => {
            this.options.disconnect(reason);
        });
        relaySocket.on('error', (reason) => {
            this.options.error(reason);
        });
    }
    _websocket(relaySocket) {
        let localU = new URL(this.localUrl);
        relaySocket.on('websocket', data => {
            let ws = new WebSocket(['ws' + localU.protocol.startsWith('https') ? 's' : '', '://', 
                localU.host, 
                data.url
            ].join(''));
            ws.on('open', () => {
                relaySocket.emit('wsOpen', {
                    _clientId: data._clientId, 
                    _reqId: data._reqId, 
                });
            });
            ws.on('close', (code, reason) => {
                relaySocket.emit('wsClose', { 
                    _clientId: data._clientId, 
                    _reqId: data._reqId, 
                    code: code, 
                    reason: reason 
                });
                this.wsMap.delete(data._reqId);
            });
            ws.on('error', e => {
                relaySocket.emit('wsError', { 
                    _clientId: data._clientId, 
                    _reqId: data._reqId, 
                    error: e 
                });
            });
            ws.on('message', m => {
                relaySocket.emit('wsClientMessage', { 
                    _clientId: data._clientId, 
                    _reqId: data._reqId, 
                    data: m 
                });
            });
            this.wsMap.set(data._reqId, {
                _clientId: data._clientId, 
                _reqId: data._reqId, 
                ws: ws
            });
        });
        relaySocket.on('wsMessage', data => {
            let wsData = this.wsMap.get(data._reqId);
            if(!wsData) {
                console.log('wsdata not set')
                return;
            }
            wsData.ws.send(data.data);
        });
        relaySocket.on('wsClose', data => {
            let wsData = this.wsMap.get(data._reqId);
            if(!wsData) {
                console.log('wsdata not set')
                return;
            }
            wsData.ws.close();
            this.wsMap.delete(data._reqId);
        });
        relaySocket.on('wsError', data => {
            let wsData = this.wsMap.get(data._reqId);
            if(!wsData) {
                console.log('wsdata not set')
                return;
            }
        });
    }
    _request(relaySocket) {
        relaySocket.on('req', (data) => {
            // don't follow redirect and ignore https cert error
            var reqOpt = {
                checkServerIdentity : function(){
                    return undefined;
                },               
            }
            Object.assign(reqOpt,data);
            reqOpt.url = this.localUrl;
            reqOpt.path = data.url;
            reqOpt.encoding = null;
            // fix error [socket hang up], no need to set content-length in request headers
            delete reqOpt.headers['Content-Length'];
            // then construct a request to local server
            
            let u = new URL(this.remoteUrl);
            if(u.protocol.startsWith('https')) {
                reqOpt.agent = new https.Agent({
                    rejectUnauthorized: false
                });
            }
            let req = (u.protocol.startsWith('https') ? https : http)
            .request(this.localUrl, reqOpt, (res) => {
                relaySocket.emit('resHead', {
                    _clientId: data._clientId, 
                    _reqId: data._reqId, 
                    statusCode: res ? res.statusCode : 500, 
                    headers: res.headers || {}
                });
                res.on('error', e => {
                    this.options.error(e);
                });
                res.on('data', d => {
                    relaySocket.emit('resWrite', { 
                        _clientId: data._clientId, 
                        _reqId: data._reqId, 
                        res: d, 
                    });
                });
                res.on('end', () => {
                    relaySocket.emit('resEnd', {
                        _clientId: data._clientId, 
                        _reqId: data._reqId, 
                    });
                    this.resMap.delete(data._reqId)
                });
                this.resMap.set(data._reqId, res);
            });

            if(data.body) {
                req.write(data.body);
            }
            
            req.end();
        });
    }
}