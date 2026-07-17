
var glClear = require('gl-clear');
var glContext = require('gl-context');

var node = require('./node.js');
var rectangle = require('./rectangle.js');

function sceggle(opts) {
  var options = opts || {};

  var gl;
  var canvas = options.canvas || document.body.appendChild(document.createElement('canvas'));
  var clear = glClear(options.clear || { color: [0, 0, 0, 1] });

  var renderList = [];
  var rootNode = node();

  function renderScene() {
    var width = gl.drawingBufferWidth;
    var height = gl.drawingBufferHeight;

    clear(gl);
    gl.viewport(0, 0, width, height);

    rootNode.updateTree();

    renderList.forEach(function render(renderable) {
      renderable.render();
    });
  }

  function registerRender(renderFunction, targetNode) {
    renderList.push({
      render: renderFunction,
      node: targetNode,
    });
  }

  gl = glContext(canvas, renderScene);

  window.addEventListener('resize',
    require('canvas-fit')(canvas),
    false
  );

  return {
    renderScene: renderScene,
    node: node.bind(this),
    rectangle: rectangle.bind(this, gl),
  };
}

module.exports = sceggle;
