
const qs = require('querystring');
const socketIo = require('socket.io');
const Bridge = require('./bridge');
const httpolyglot 	= require('httpolyglot');

module.exports = class Server {
    options = {
        connect: () => {},
        client: () => {},
        disconnect: () => {},
        listening: () => {},
        error: () => {}
    };
    responseMap = new Map();
    clientMap = new Map();
    bridgeMap = new Map();
    _reqId = 0;
    _clientId = 0;
    constructor(options = {}) {
        Object.assign(this.options, options);  
    }
    createServer(tlsConfig = {}, requestListener) {
        this.server = httpolyglot.createServer(tlsConfig, requestListener);

        let io = socketIo(this.server);
       
        io.use((socket, next) => {
            //TODO match Auth headers
            if(1) {
                return next();
            }
            next(new Error('Not Authorized'));
        });
        io.on('connection', socket => {
            //socket comig from a remote client
            socket.on('client', (data) => {
                socket._type = 'client';
                socket._clientId = ++this._clientId;
                this.clientMap.set(socket._clientId, {
                    _clientId: socket._clientId,
                    socket: socket,
                    meta: data.meta
                });
            });
            //socket comming from a local bridge
            socket.on('bridge', (data => {
                socket._type = 'bridge';
                socket._clientId = ++this._clientId;
                this.bridgeMap.set(socket._clientId, socket);
            }));

            // handle req from server, relay data to client
            socket.on('req', (data) => {
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
            socket.on('resHead', (data) => {
                var _rid = data._reqId;
                let d = this.responseMap.get(_rid);
                if(!d)
                    return;
                d.res.writeHead(data.statusCode || 200, data.headers || {});
            });
            socket.on('resWrite', (data) => {
                var _rid = data._reqId;
                let d = this.responseMap.get(_rid);
                if(!d)
                    return;
                d.res.write(data.res);
            });
            socket.on('resEnd', (data) => {
                var _rid = data._reqId;
                let d = this.responseMap.get(_rid);
                if(!d)
                    return;
                d.res.end();
                this.responseMap.delete(_rid);
            });
            socket.on('disconnect', (reason) => {
                switch(socket._type) {
                    case 'client':
                        //remote socket
                        this.clientMap.delete(socket._clientId);
                        break;
                    case 'bridge':
                        //local socket
                        this.bridgeMap.delete(socket._clientId);
                        //TODO cancel all responses with this clientId
                        break;
                }
            });
        });
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
    
    middleware(req, res, next) {
        req._reqId = ++this._reqId;
        req._clientId = this.findServer(req)._clientId;
        // check lowercase headers(e.g parsed by express), use raw headers
        for(let i in req.rawHeaders) {
            var header = req.rawHeaders[i].toLowerCase();
            if(header != req.rawHeaders[i] && req.headers[header]) {
                req.headers[req.rawHeaders[i]] = req.headers[header];
                delete req.headers[header];
            }
        }
        let b = new Bridge(this.port);
        this.responseMap.set(req._reqId, {
            res: res,
            next: next
        });
        // pass the req main content to local server via WS
        if(!req.body && req.method !== 'GET') {
            var body = '';
            req.on('data', (chunk) => {
                body += chunk;
                //TODO: should set a limit for data
            })
            req.on('end', () => {
                req.body = qs.parse(body);
                b.request(req);
                
            });
        } else {
            b.request(req);
        }
    }
    findServer(req) {
        return this.clientMap.entries().next().value[1];
    }
}