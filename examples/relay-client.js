/*
 * Simple demo as Ngrok client, run this in your local network
 */

const RelayTunnel = require('../index')

let tunnel = new RelayTunnel.Client('http://localhost:3001', 'http://localhost:33300', {
    connect: () => console.log('connect'),
    disconnect: (reason) => console.log('disconnect', reason),
    hold: () => console.log('hold'),
    error: (e) => console.log('error', e)

});
tunnel.connect();