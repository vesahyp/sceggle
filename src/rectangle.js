
var glBuffer = require('gl-buffer');
var glShader = require('gl-shader');
var glslify = require('glslify');

var shader;
var square;

function rectangle(gl) {
  if (!gl) {
    throw new Error('gl context undefined');
  }

  shader = glShader(gl,
    glslify('./shaders/rectangle_shader.vert'),
    glslify('./shaders/rectangle_shader.frag')
  );

  square = glBuffer(gl, new Float32Array([
    +1.0, +1.0, +0.0,
    -1.0, +1.0, +0.0,
    +1.0, -1.0, +0.0,
    -1.0, -1.0, +0.0,
  ]));

  function render() {
    shader.bind();
    square.bind();
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  return {
    render: render,
  };
}

module.exports = rectangle;
