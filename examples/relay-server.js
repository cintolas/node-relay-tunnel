
const express = require('express');

const app = express();
const port = 3000;
const Tunnel = require('../index');

let server = new Tunnel.Server({
  error: console.log,
  listening: console.log
});
server.createServer().listen(33300);


app.get('/qqq', (req, res) => {
	res.send('Hello World!').end();
});

app.use(server.middleware.bind(server));

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});