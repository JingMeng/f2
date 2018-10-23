const Util = require('../util/common');
const { Group } = require('../graphic/');
const DEFAULT_CFG = {
  anchor_offset: 5, // 锚点的偏移量
  inflection_offset: 15,
  padding: 10, // 文本距离画布四边的距离
  lineHeight: 32, // 文本的行高
  adjust_offset: 15, // 发生调整时的偏移量
  skipOverlapLabels: false, // 是否不展示重叠的文本
  lineStyle: {},
  anchorStyle: {},
  label1: {},
  label2: {},
  onClick: null
};

function getEndPoint(center, angle, r) {
  return {
    x: center.x + r * Math.cos(angle),
    y: center.y + r * Math.sin(angle)
  };
}

// 计算中间角度
function getMiddleAngle(startAngle, endAngle) {
  if (endAngle < startAngle) {
    endAngle += Math.PI * 2;
  }
  return (endAngle + startAngle) / 2;
}

// 判断两个矩形是否相交
function isOverlap(label1, label2) {
  const label1BBox = label1.getBBox();
  const label2BBox = label2.getBBox();
  return (
    (Math.max(label1BBox.minX, label2BBox.minX) <= Math.min(label1BBox.maxX, label2BBox.minX))
    &&
    (Math.max(label1BBox.minY, label2BBox.minY) <= Math.min(label1BBox.maxY, label2BBox.maxY))
  );
}

class controller {
  constructor(cfg) {
    Util.mix(this, cfg);
    const chart = this.chart;
    this.canvasDom = chart.get('canvas').get('el');
    // this.clear();
  }

  renderLabels() {
    const self = this;
    const chart = this.chart;
    const coord = chart.get('coord');
    const { center, circleRadius: radius } = coord;
    const height = chart.get('height');
    const labelGroup = this.labelGroup;

    const halves = [
      [], // left
      []  // right
    ]; // 存储左右 labels
    const geom = chart.get('geoms')[0];
    const shapes = geom.get('container').get('children');
    const { anchor_offset, inflection_offset, label1, label2, lineHeight, skipOverlapLabels } = this.pieLabelCfg;
    shapes.forEach(shape => {
      const shapeAttrs = shape.attr();
      const origin = shape.get('origin');
      const { startAngle, endAngle } = shapeAttrs;
      const middleAngle = getMiddleAngle(startAngle, endAngle);
      const anchorPoint = getEndPoint(center, middleAngle, radius + anchor_offset);
      const inflectionPoint = getEndPoint(center, middleAngle, radius + inflection_offset);
      const { _origin, color } = origin;
      const label = {
        _anchor: anchorPoint,
        _inflection: inflectionPoint,
        _data: _origin,
        x: inflectionPoint.x,
        y: inflectionPoint.y,
        r: radius + inflection_offset,
        fill: color
      };

      const textGroup = new Group({
        data: _origin // 存储原始数据
      });
      if (label1) {
        textGroup.addShape('Text', {
          attrs: Util.mix({
            x: 0,
            y: 0,
            fontSize: 12,
            fill: '#808080',
            textBaseline: 'bottom'
          }, label1(_origin, color)),
          origin: _origin // 存储原始数据
        });
      }

      if (label2) {
        textGroup.addShape('Text', {
          attrs: Util.mix({
            x: 0,
            y: 0,
            fontSize: 12,
            fill: '#808080',
            textBaseline: 'top'
          }, label2(_origin, color)),
          origin: _origin // 存储原始数据
        });
      }
      label.textGroup = textGroup;
      // 判断文本的方向
      if (anchorPoint.x < center.x) {
        label._side = 'left';
        halves[0].push(label);
      } else {
        label._side = 'right';
        halves[1].push(label);
      }
    });

    let drawnLabels = [];

    if (skipOverlapLabels) {
      let lastLabel; // 存储上一个 label 对象，用于检测文本是否重叠
      const labels = halves[0].concat(halves[1]);
      for (let i = 0, len = labels.length; i < len; i++) {
        const label = labels[i];
        const textGroup = self._drawLabel(label);
        if (lastLabel) {
          if (isOverlap(textGroup, lastLabel)) { // 重叠了就不绘制
            lastLabel = textGroup;
            continue;
          }
        }

        labelGroup.add(textGroup);
        drawnLabels.push(textGroup);
        self._drawLabelLine(label);
        lastLabel = textGroup;
      }
    } else {
      const maxCountForOneSide = parseInt(height / lineHeight, 10);

      halves.forEach(half => {
        if (half.length > maxCountForOneSide) {
          half.sort((a, b) => {
            return b._percent - a._percent;
          });
          half.splice(maxCountForOneSide, half.length - maxCountForOneSide);
        }

        half.sort((a, b) => {
          return a.y - b.y;
        });

        const labels = self._antiCollision(half);
        drawnLabels = drawnLabels.concat(labels);
      });
    }

    this.drawnLabels = drawnLabels;
  }

  clear() {
    const labelGroup = this.labelGroup;
    labelGroup && labelGroup.clear();
    this.drawnLabels = [];
    this.unBindEvents();
  }

  _drawLabel(label) {
    const { pieLabelCfg, chart } = this;
    const canvasWidth = chart.get('width');
    const { padding } = pieLabelCfg;
    const { y, textGroup } = label;

    const children = textGroup.get('children');
    if (label._side === 'left') { // 具体文本的位置
      children.forEach(child => {
        child.attr({
          textAlign: 'left',
          x: padding,
          y
        });
      });
    } else {
      children.forEach(child => {
        child.attr({
          textAlign: 'right',
          x: canvasWidth - padding,
          y
        });
      });
    }
    return textGroup;
  }

  _drawLabelLine(label, maxLabelWidth) {
    const { chart, pieLabelCfg, labelGroup } = this;
    const canvasWidth = chart.get('width');
    const { padding, adjust_offset, lineStyle, anchorStyle, skipOverlapLabels } = pieLabelCfg;
    const { _anchor, _inflection, fill, y } = label;
    const lastPoint = {
      x: label._side === 'left' ? padding : canvasWidth - padding,
      y
    };

    let points = [
      _anchor,
      _inflection,
      lastPoint
    ];
    if (!skipOverlapLabels && _inflection.y !== y) { // 展示全部文本文本位置做过调整
      if (_inflection.y < y) { // 文本被调整下去了，则添加拐点连接线
        const point1 = _inflection;
        const point2 = {
          x: label._side === 'left' ? lastPoint.x + maxLabelWidth + adjust_offset : lastPoint.x - maxLabelWidth - adjust_offset,
          y: _inflection.y
        };
        const point3 = {
          x: label._side === 'left' ? lastPoint.x + maxLabelWidth : lastPoint.x - maxLabelWidth,
          y: lastPoint.y
        };

        points = [
          _anchor,
          point1,
          point2,
          point3,
          lastPoint
        ];

        if ((label._side === 'right' && point2.x < point1.x) || (label._side === 'left' && point2.x > point1.x)) {
          points = [
            _anchor,
            point3,
            lastPoint
          ];
        }
      } else {
        points = [
          _anchor,
          {
            x: _inflection.x,
            y
          },
          lastPoint
        ];
      }
    }

    labelGroup.addShape('Polyline', {
      attrs: Util.mix({
        points,
        lineWidth: 1,
        stroke: fill
      }, lineStyle)
    });

    // 绘制锚点
    labelGroup.addShape('Circle', {
      attrs: Util.mix({
        x: _anchor.x,
        y: _anchor.y,
        r: 2,
        fill
      }, anchorStyle)
    });
  }

  _antiCollision(half) {
    const self = this;
    const { chart, pieLabelCfg } = this;
    const coord = chart.get('coord');
    // const pieLabelCfg = chart.get('pieLabelCfg');
    const canvasHeight = chart.get('height');
    const { center, circleRadius: r } = coord;
    const { inflection_offset, lineHeight } = pieLabelCfg;
    const startY = center.y - r - inflection_offset - lineHeight;
    let overlapping = true;
    let totalH = canvasHeight;
    let i;

    let maxY = 0;
    let minY = Number.MIN_VALUE;
    let maxLabelWidth = 0;
    const boxes = half.map(function(label) {
      const labelY = label.y;
      if (labelY > maxY) {
        maxY = labelY;
      }
      if (labelY < minY) {
        minY = labelY;
      }

      const textGroup = label.textGroup;
      const labelWidth = textGroup.getBBox().width;
      if (labelWidth >= maxLabelWidth) {
        maxLabelWidth = labelWidth;
      }

      return {
        size: lineHeight,
        targets: [ labelY - startY ]
      };
    });
    if ((maxY - startY) > totalH) {
      totalH = maxY - startY;
    }

    while (overlapping) {
      boxes.forEach(box => {
        const target = (Math.min.apply(minY, box.targets) + Math.max.apply(minY, box.targets)) / 2;
        box.pos = Math.min(Math.max(minY, target - box.size / 2), totalH - box.size);
      });

      // detect overlapping and join boxes
      overlapping = false;
      i = boxes.length;
      while (i--) {
        if (i > 0) {
          const previousBox = boxes[i - 1];
          const box = boxes[i];
          if (previousBox.pos + previousBox.size > box.pos) { // overlapping
            previousBox.size += box.size;
            previousBox.targets = previousBox.targets.concat(box.targets);

            // overflow, shift up
            if (previousBox.pos + previousBox.size > totalH) {
              previousBox.pos = totalH - previousBox.size;
            }
            boxes.splice(i, 1); // removing box
            overlapping = true;
          }
        }
      }
    }

    i = 0;
    boxes.forEach(function(b) {
      let posInCompositeBox = startY; // middle of the label
      b.targets.forEach(function() {
        half[i].y = b.pos + posInCompositeBox + lineHeight / 2;
        posInCompositeBox += lineHeight;
        i++;
      });
    });

    const drawnLabels = [];
    half.forEach(function(label) {
      const textGroup = self._drawLabel(label);
      const labelGroup = self.labelGroup;
      labelGroup.add(textGroup);
      self._drawLabelLine(label, maxLabelWidth);
      drawnLabels.push(textGroup);
    });

    return drawnLabels;
  }

  bindEvents() {
    const pieLabelCfg = this.pieLabelCfg;
    const triggerOn = pieLabelCfg.triggerOn || 'touchstart';
    const method = Util.wrapBehavior(this, '_handleEvent');
    Util.addEventListener(this.canvasDom, triggerOn, method);
  }

  unBindEvents() {
    const pieLabelCfg = this.pieLabelCfg;
    const triggerOn = pieLabelCfg.triggerOn || 'touchstart';
    const method = Util.getWrapBehavior(this, '_handleEvent');
    Util.removeEventListener(this.canvasDom, triggerOn, method);
  }

  _handleEvent(ev) {
    const self = this;
    const chart = self.chart;
    const drawnLabels = self.drawnLabels;
    const { onClick } = self.pieLabelCfg;
    const canvasEvent = Util.createEvent(ev, chart);
    const { x, y } = canvasEvent;

    // 查找被点击的 label
    let clickedShape;
    for (let i = 0, len = drawnLabels.length; i < len; i++) {
      const shape = drawnLabels[i];
      const bbox = shape.getBBox();
      if (x >= bbox.minX && x <= bbox.maxX && y >= bbox.minY && y <= bbox.maxY) {
        clickedShape = shape;
        break;
      }
    }

    const pieData = chart.getSnapRecords({ x, y });
    if (clickedShape) {
      canvasEvent.data = clickedShape.get('data');
    } else if (pieData.length) {
      canvasEvent.data = pieData[0]._origin;
    }

    onClick && onClick(canvasEvent);
  }
}


module.exports = {
  init(chart) {
    const frontPlot = chart.get('frontPlot');
    const labelGroup = frontPlot.addGroup({
      className: 'pie-label',
      zIndex: 0
    });
    const pieLabelController = new controller({
      chart,
      labelGroup
    });
    chart.set('pieLabelController', pieLabelController);
    chart.pieLabel = function(cfg) {
      cfg = Util.deepMix({}, DEFAULT_CFG, cfg);
      pieLabelController.pieLabelCfg = cfg;

      return this;
    };

  },
  afterGeomDraw(chart) {
    const controller = chart.get('pieLabelController');
    controller.renderLabels();
    controller.bindEvents();
  },
  clearInner(chart) {
    const controller = chart.get('pieLabelController');
    controller.clear();
  }
};
