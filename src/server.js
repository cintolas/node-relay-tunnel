const socketIo = require('socket.io');
const Bridge = require('./bridge');
const httpolyglot 	= require('httpolyglot');
const WebSocket = require('ws');


module.exports = class Server {
    options = {
        connect: () => {},
        client: () => {},
        disconnect: () => {},
        listening: () => {},
        error: () => {}
    };
    responseMap = new Map();
    wsMap = new Map();
    clientMap = new Map();
    bridgeMap = new Map();
    relaySocketMap = new Map();
    _reqId = 0;
    _clientId = 0;
    _bridgeId = 0;
    _useArr = [];
    _bridgeOptions = {};
    _router = (req, clientMap) => {
        //return random client
        let k = Array.from(clientMap.keys());
        return clientMap.get(k[Math.floor(Math.random() * k.length)]);
    }
    constructor(options = {}) {
        Object.assign(this.options, options);  
    }
    setBridgeSocketOptions(sockOpts) {
        this._bridgeOptions = sockOpts;
    }
    createServer(tlsConfig = {}, requestListener) {
        this.server = httpolyglot.createServer(tlsConfig, requestListener);

        let io = socketIo(this.server);
       
        let useFn;
        while(useFn = this._useArr.shift()) {
            io.use(useFn);
        }
        io.on('connection', relaySocket => {
            this._setup(relaySocket);
            this._response(relaySocket);
            this._websocket(relaySocket);
        });
        return this;
    }
    use(fn = (socket, next) => next()) {
        this._useArr.push(fn);
        return this;
    }
    listen(port) {
        this.port = port;
        this.server.listen(port)
        .on('listening', () => {
            this.options.listening();
        })
        .on('error', (e) => {
            this.options.error(e);
        });
    }
    _setup(relaySocket) {
        //socket comig from a remote client
        relaySocket.on('client', (data) => {
            relaySocket._type = 'client';
            relaySocket._clientId = ++this._clientId;
            this.clientMap.set(relaySocket._clientId, {
                _clientId: relaySocket._clientId,
                socket: relaySocket,
                meta: data.meta
            });
        });
        //socket comming from a local bridge
        relaySocket.on('bridge', (data => {
            relaySocket._type = 'bridge';
            relaySocket._clientId = ++this._bridgeId;
            this.bridgeMap.set(relaySocket._clientId, relaySocket);
        }));
        relaySocket.on('disconnect', (reason) => {
            switch(relaySocket._type) {
                case 'client':
                    //remote socket
                    this.clientMap.delete(relaySocket._clientId);
                    break;
                case 'bridge':
                    //local socket
                    this.bridgeMap.delete(relaySocket._clientId);
                    //TODO cancel all responses with this clientId
                    break;
            }
        });
        relaySocket.on('meta', data => {
            let cl = this.clientMap.get(relaySocket._clientId);
            if(!cl) {
                return;
            }
            cl.meta = data;
            this.clientMap.set(relaySocket._clientId, cl);
        });
        relaySocket.on('error', (e) => {
            console.log('error', e);
        });

    }
    setRouter(fn) {
        this._router = fn;
    }
    async middleware(req, res, next) {
        req._reqId = ++this._reqId;

         // check lowercase headers(e.g parsed by express), use raw headers
         for(let i in req.rawHeaders) {
            var header = req.rawHeaders[i].toLowerCase();
            if(header != req.rawHeaders[i] && req.headers[header]) {
                req.headers[req.rawHeaders[i]] = req.headers[header];
                delete req.headers[header];
            }
        }
        let b = new Bridge(this.port, this._bridgeOptions);

        this.responseMap.set(req._reqId, {
            res: res,
            next: next
        });
        if(!req.body && req.method !== 'GET') {
            var body = '';
            req.on('data', (chunk) => {
                body += chunk;
                //TODO: should set a limit for data
            })
            req.on('end', async() => {
                req.body = body;
                try {
                    req._clientId = await this.findServer(req)._clientId;
                    if(!req._clientId) {
                        throw new Error('ClientId missing')
                    }
                } catch(e) {
                    this.responseMap.delete(req._reqId);
                    next(e);
                    
                    return;
                }
              
                if(!req._clientId) {
                    this.responseMap.delete(req._reqId);
                    next(new Error('cannot find client to connect to'));
                    return;
                }
                b.request(req);
            });
        } else {
            try {
                req._clientId = await this.findServer(req)._clientId;
                if(!req._clientId) {
                    throw new Error('ClientId Missing')
                }
            } catch(e) {
                this.responseMap.delete(req._reqId);
                next(e);
                return;
            }
            b.request(req);
        }      
    }
    _response(relaySocket) {
        // handle req from server, relay data to client
        relaySocket.on('req', (data) => {
            if(!data._reqId)
                return;
            let client = this.clientMap.get(data._clientId);
            if(!client) {
                let d = this.responseMap.get(data._reqId);
                if(!d) {
                    return;
                }
                d.res.status(500);
                d.res.write('Missing Client');
                d.res.end();
                this.responseMap.delete(data._reqId);
                return;
            }
            client.socket.emit('req', data);
        });
        // handle res from client, relay the data to the server
        relaySocket.on('resHead', (data) => {
            var _rid = data._reqId;
            let d = this.responseMap.get(_rid);
            if(!d)
                return;
            d.res.writeHead(data.statusCode || 200, data.headers || {});
        });
        relaySocket.on('resWrite', (data) => {
            var _rid = data._reqId;

            let d = this.responseMap.get(_rid);
            if(!d)
                return;
            d.res.write(data.res);
        });
        relaySocket.on('resEnd', (data) => {
            var _rid = data._reqId;
            let d = this.responseMap.get(_rid);
            if(!d)
                return;
            d.res.end();
            this.responseMap.delete(_rid);
        });
    }
    websocket(pubServer) {
        const wss = new WebSocket.Server({ noServer: true });
       
        wss.on('connection', (ws, request) => {
            let req = request;
            req._reqId = ++this._reqId,
            req._clientId = this.findServer(req)._clientId;

            let b = new Bridge(this.port, this._bridgeOptions);
            ws.on('message', m => {
                let client = this.clientMap.get(req._clientId);
                if(!client) {
                    this.wsMap.delete(req._reqId);
                    ws.close(1000, "remote host closed the connection");
                    return;
                }
                let wsData = this.wsMap.get(req._reqId);

                if(!wsData) {
                    //probably should close this
                    return;
                }else if(!wsData.ready) {
                    wsData.buf = wsData.buf || [];
                    wsData.buf.push(m);
                    this.wsMap.set(req._reqId, wsData);
                    return;
                }
                client.socket.emit('wsMessage', {
                    _reqId: req._reqId,
                    _clientId: req._clientId,
                    data: m
                });
            });
            ws.on('close', () => {
                this.wsMap.delete(req._reqId);
                let client = this.clientMap.get(req._clientId);
                if(!client)
                    return;
                client.socket.emit('wsClose', {
                    _reqId: req._reqId,
                    _clientId: req._clientId
                });
            }); 
            ws.on('error', (e) => {
                this.wsMap.delete(req._reqId);
                let client = this.clientMap.get(req._clientId);
                if(!client)
                    return;
                client.socket.emit('wsError', {
                    _reqId: req._reqId,
                    _clientId: req._clientId,
                    data: e
                });
            });
            this.wsMap.set(req._reqId, {
                ws: ws
            });
            b.websocket(req);      
        });
        pubServer.on('upgrade', function upgrade(request, socket, head) {
            wss.handleUpgrade(request, socket, head, function done(ws) {
                wss.emit('connection', ws, request);
            });
          });
    }
    _websocket(relaySocket) {
        relaySocket.on('websocket', data => {
            if(!data._reqId)
                return;
            let client = this.clientMap.get(data._clientId);
            if(!client) {
                let d = this.responseMap.get(data._reqId);
                if(!d) {
                    return;
                }
                d.res.status(500);
                d.res.write('Missing Client');
                d.res.end();
                this.responseMap.delete(data._reqId);
                return;
            }
            client.socket.emit('websocket', data);
        });
        relaySocket.on('wsOpen', data => {
            let wsData = this.wsMap.get(data._reqId);
            if(!wsData)
                return;
            if(!wsData.buf)
                return;
            let client = this.clientMap.get(data._clientId);
            if(!client) {
                wsData.ws.close(1000, 'remote host is down');
                this.wsMap.delete(data._reqId);
                return;
            }
            wsData.buf.forEach(c => {
                client.socket.emit('wsMessage', {
                    _reqId: data._reqId,
                    _clientId: data._clientId,
                    data: c
                });
            });
            delete wsData.buf;
            wsData.ready = true;
            this.wsMap.set(data._reqId, wsData);
        });
        relaySocket.on('wsClose', data => {
            var _rid = data._reqId;
            let d = this.responseMap.get(_rid);
            if(!d)
                return;
            d.res.end();
            this.responseMap.delete(_rid);
        });
        relaySocket.on('wsError', data => {
            console.log('websocket error', data)
        });
        relaySocket.on('wsClientMessage', data => {
            let wsData = this.wsMap.get(data._reqId);
            if(!wsData) {
                return;
            }
            wsData.ws.send(data.data);
        });
    }
    
    findServer(req) {  
        if(!this.clientMap.size)
            return {};
        return this._router(req, this.clientMap);
    }
}