var sceggle = require('../../src/index.js');

var scene = sceggle();

var bg = scene.node()
  .addRender(scene.rectangle());

console.log(bg);
