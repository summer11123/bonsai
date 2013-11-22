define([
  '../../tools',
  '../../event_emitter',
  '../../runner/path/curved_path'
], function(tools, EventEmitter, CurvedPath) {
  'use strict';

  function Tree(id, type) {
    this.id = id;
    this.type = type;
    this.attributes = this.data =
      this.previous = this.next = this.parent =
      this.firstChild = this.lastChild = null;
  }
  tools.mixin(Tree.prototype, {
    insert: function(node, next) {
      if (node.parent) node.parent.remove(node);

      var previous;
      if (next) {
        previous = node.previous = next.previous || this.lastChild;
        next.previous = node;
        node.next = next;
      } else {
        previous = node.previous = this.lastChild;
        this.lastChild = node;
      }

      if (previous) {
        previous.next = node;
        if (this.lastChild === previous) this.lastChild = node;
      } else {
        this.firstChild = this.lastChild = node;
      }
    },
    remove: function(node) {
      var next = node.next, previous = node.previous;
      if (previous) previous.next = next;
      if (next) next.previous = previous;
      if (this.firstChild === node) this.firstChild = next;
      if (this.lastChild === node) this.lastChild = previous;
      node.parent = node.next = node.previous = null;
    },
    draw: function(context) {
      var attributes = this.attributes;
      var matrix = attributes && attributes.matrix;
      if (matrix) {
        context.save();
        context.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty);
      }

      if (this.type === 'Path') {
        drawPath(context, attributes, this.data);
      }

      var child = this.firstChild;
      while (child) {
        child.draw(context);
        child = child.next;
      }

      if (matrix) context.restore();
    }
  });

  function CanvasRenderer(container, width, height, options) {
    var canvas = this.canvas = container.ownerDocument.createElement('canvas');
    var context = this.context = canvas.getContext('2d');
    context.translate(.5, 0);

    var root = this.root = new Tree(0);
    root.nodes = {0: root};

    this.width = canvas.width = width;
    this.height = canvas.height = height;
    this._fpsLog = !!(options && options.fpsLog);
    this._times = [];
    container.appendChild(canvas);
  }

  tools.mixin(CanvasRenderer.prototype, EventEmitter, {
    getOffset: function() {
      return this.canvas.getBoundingClientRect();
    },

    render: function(messages) {
      var root = this.root, nodes = root.nodes, positionUpdates = [];
      var mixin = tools.mixin;
      for (var i = 0, n = messages.length; i < n; i++) {
        var message = messages[i], id = message.id;
        var node = root.nodes[id];

        if (message.detach) {
          if (node && node.parent) node.parent.remove(node);
          delete nodes[id];
        } else {
          if (!node) { // create node ...
            node = nodes[id] = new Tree(id, message.type);
            node.attributes = message.attributes;
          } else { // ... or update attributes
            mixin(node.attributes, message.attributes);
          }
          if (message.data) node.data = message.data;
        }

        if ('parent' in message) { // position has changed
          positionUpdates.push(node, message.parent, message.next);
        }
      }

      for (i = 0, n = positionUpdates.length; i < n; i += 3) {
        var parentId = positionUpdates[i + 1], nextId = positionUpdates[i+2];
        var parent = nodes[parentId];
        if (parent) parent.insert(positionUpdates[i], nodes[nextId]);
      }

      var context = this.context;
      context.clearRect(0, 0, this.width, this.height);
      this.root.draw(context);

      if (this._fpsLog) {
        var times = this._times;
        var fps = 0, now = Date.now(), stop = now - 1000;
        n = times.unshift(now);
        for (i = 0; i < n && times[i] > stop; i++) fps++;
        times.length = i;
        context.font = '20px Arial';
        context.fillText(fps + 'FPS', 5, 20);
      }
      this.emit('canRender');
    },

    destroy: function() {
      var canvas = this.canvas;
      this.canvas = this.context = null;
      canvas.parentNode && canvas.parentNode.removeChild(canvas);
    }
  });

  function drawPath(context, attributes, data) {

//    clipId: null
//    cursor: null
//    fillGradient: undefined
//    fillImageId: null
//    fillOpacity: 1
//    fillRepeat: Array[2]
//    fillRule: "inherit"
//    filters: Array[0]
//    interactive: true
//    maskId: null
//    matrix: Object
//    miterLimit: 4
//    opacity: 1
//    strokeDash: null
//    strokeDashOffset: 0
//    strokeGradient: undefined
//    strokeOpacity: 1
//    strokeWidth: 0
//    visible: true

    context.beginPath();
    var fillColor = attributes.fillColor;
    var strokeColor = attributes.strokeColor;
    var strokeWidth = attributes.strokeWidth;

    context.fillStyle = rgba(fillColor);
    context.strokeStyle = rgba(strokeColor);
    context.lineCap = attributes.cap;
    context.lineJoin = attributes.join;
    context.lineWidth = strokeWidth;
    context.globalAlpha *= attributes.opacity;

    var x = 0, y = 0;
    for (var i = 0, n = data.length; i < n; i++) {
      var op = data[i], type = op[0];
      if (type === 'moveTo') {
        x = op[1];
        y = op[2];
        context.moveTo(x, y);
      } else if (type === 'lineBy') {
        x += op[1];
        y += op[2];
        context.lineTo(x, y);
      } else if (type === 'lineTo') {
        x = op[1];
        y = op[2];
        context.lineTo(x, y);
      } else if (type === 'curveTo') {
        x = op[5];
        y = op[6];
        context.bezierCurveTo(op[1], op[2], op[3], op[4], x, y);
      } else if (type === 'closePath') {
        context.closePath();
      } else if (type === 'arcTo') {
        var segments = CurvedPath.subPathToCurves([['moveTo',x,y], op]);
        segments.splice(0, 1, i, 1);
        var o = data.splice.apply(data, segments);
        n = data.length;
        i -= 1;
      } else {
        console.log(op.join(', '));
      }
    }

    if (fillColor) context.fill();
    if (strokeWidth && strokeColor) context.stroke();
  }

  function rgba(color) {
    if (!color) return 'transparent';
    var a = (color & 0xff) / 0xff;
    if (a === 1) return '#' + ('00000' + (color.toString(16))).slice(-6);

    var r = color >>> 24 & 0xff;
    var g = color >>> 16 & 0xff;
    var b = color >>> 8 & 0xff;

    return 'rgba(' + [r, g, b, a].join(',') + ')';
  }

  return CanvasRenderer;
});
