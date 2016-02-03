
var mat4 = require('gl-mat4');
var vec3 = require('gl-vec3');

/**
 * Creates node with parameters
 *
 * this always points to sceggle instance
 * @param {opts} options:
 */
function node(opts) {
  var options = opts || {};
  var sceggle = this;

  var self;

  var parent;
  var children = [];

  var position = options.position || vec3.create();
  var rotate = options.rotate || vec3.create();
  var scale = options.scale || vec3.create();
  var origin = options.origin || vec3.create();
  var size = options.size || vec3.create();
  var opacity = 0.0;

  var localMatrix = mat4.create();
  var worldMatrix = mat4.create();

  function addRender(renderable) {
    if (!renderable || typeof renderable !== 'function' || !renderable.render) {
      throw new Error('Renderable not of type function or missing renderable.render', renderable);
    }
    sceggle.registerRender(typeof renderable === 'function' ? renderable : renderable.render, self);
  }

  function setParent(newParent) {
    var index;
    if (parent) {
      index = parent.children.indexOf(self);
      if (index >= 0) {
        parent.children.splice(index, 1);
      }
    }
    if (newParent) {
      newParent.children.push(self);
    }
    parent = newParent;
    return self;
  }

  function updateWorldMatrix() {
    if (parent && parent.worldMatrix) {
      // a matrix was passed in so do the math and
      // store the result in `this.worldMatrix`.
      mat4.multiply(localMatrix, parent.worldMatrix, worldMatrix);
    } else {
      // no matrix was passed in so just copy.
      mat4.copy(localMatrix, worldMatrix);
    }
  }

  function updateLocalMatrix() {
    mat4.identity(localMatrix);

    mat4.translate(localMatrix, localMatrix, position);
    mat4.rotateZ(localMatrix, localMatrix, -this.rotate.z);
    mat4.rotateY(localMatrix, localMatrix, -this.rotate.y);
    mat4.rotateX(localMatrix, localMatrix, -this.rotate.x);
    mat4.scale(localMatrix, localMatrix, this.scale);

    // mat4.translate(localMatrix, localMatrix, origin);
  }

  function updateTree() {
    updateLocalMatrix();
    updateWorldMatrix();

    // process all the children
    this.children.forEach(function updateChildTree(child) {
      child.updateTree();
    });
  }

  self = {
    position: position,
    rotate: rotate,
    scale: scale,
    origin: origin,
    size: size,
    opacity: opacity,
    parent: parent,
    children: children,
    setParent: setParent,
    updateWorldMatrix: updateWorldMatrix,
    updateTree: updateTree,
    addRender: addRender,
  };

  return self;
}

module.exports = node;
