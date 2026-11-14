/**
 * 設備アイコン・工事吹き出しなどの表示設定とズーム連動。
 * 見た目の倍率だけを変更し、保存座標やLeafletが管理する位置変換を上書きしません。
 */
window.FactoryDisplay = (() => {
  let values = FactoryAppearance.normalize();
  let referenceZoom = 0;
  let markers = [];
  let works = [];
  let map;
  let app;
  const settings = () => values;
  /**
   * 図面に合わせた基準ズームとの差から表示倍率を求めます。
   * 緩やかな連動は倍率の変化を抑え、最小倍率で縮小時の判読性を確保します。
   */
  function factor(mode, zoom = map?.getZoom() ?? referenceZoom) {
    return mode === 'fixed'
      ? 1
      : Math.max(
          values.minimumScale / 100,
          Math.min(1.6, 2 ** ((zoom - referenceZoom) * (mode === 'map' ? 1 : 0.35))),
        );
  }
  function iconPixels(zoom) {
    return values.iconSize * factor(values.iconScale, zoom);
  }
  function updateMarker(marker, zoom) {
    const el = marker.getElement();
    if (!el) {
      return;
    }
    const size = iconPixels(zoom);
    el.style.width = el.style.height = size + 'px';
    el.style.marginLeft = el.style.marginTop = -size / 2 + 'px';
    el.style.setProperty('--asset-symbol-size', size + 'px');
    el.style.setProperty('--asset-opacity', values.equipmentOpacity / 100);
    const symbol = el.querySelector('.equipment-symbol');
    if (symbol) {
      if (marker.options.presentationColor) {
        symbol.style.backgroundColor = marker.options.presentationColor;
      } else {
        symbol.style.removeProperty('background-color');
      }
    }
    const tooltip = marker.getTooltip();
    if (tooltip) {
      tooltip.options.offset = L.point(0, -size / 2);
      updateTooltip(marker, 'equipment', zoom);
    }
  }
  function updateTooltip(layer, kind, zoom) {
    const tooltip = layer.getTooltip();
    const el = tooltip?.getElement();
    if (!el) {
      return;
    }
    if (kind === 'work') {
      const scale = factor(values.workScale, zoom);
      el.style.fontSize = values.workLabelSize * scale + 'px';
      el.style.maxWidth = values.workLabelWidth * scale + 'px';
      el.style.padding = `${5 * scale}px ${9 * scale}px`;
      el.style.setProperty('--work-label-scale', scale);
      el.style.opacity = values.workLabelOpacity / 100;
    } else {
      el.style.fontSize = values.equipmentLabelSize + 'px';
    }
    tooltip.update();
  }
  function trackAsset(marker) {
    markers.push(marker);
    marker.on('add', () => updateMarker(marker));
    marker.on('tooltipopen', () => updateTooltip(marker, 'equipment'));
  }
  function trackWork(layer) {
    works.push(layer);
    layer.on('tooltipopen', () => {
      const el = layer.getTooltip()?.getElement();
      if (el) {
        el.dataset.workId = layer.options.workId;
      }
      updateTooltip(layer, 'work');
    });
  }
  function refresh(zoom) {
    document
      .querySelectorAll('.leaflet-control-scale')
      .forEach((el) => (el.hidden = !values.scaleBar));
    for (const marker of markers) {
      updateMarker(marker, zoom);
    }
    for (const layer of works) {
      updateTooltip(layer, 'work', zoom);
    }
  }
  function clear() {
    markers = [];
    works = [];
  }
  function setDrawing(drawing) {
    if (map) {
      referenceZoom = map.getBoundsZoom(L.latLngBounds(drawing.bounds), false, L.point(90, 130));
    }
  }
  function workStyle(work, selected) {
    const color =
      (values.workColors === 'layer'
        ? app?.state.layers?.find((l) => l.id === work.layerId)?.color
        : null) ||
      values[work.status + 'Color'] ||
      '#779ed0';
    return {
      color,
      weight: values.workStroke + (selected ? 1 : 0),
      fillColor: color,
      fillOpacity: Math.min(0.8, values.workFill / 100 + (selected ? 0.12 : 0)),
      dashArray: work.status === 'planned' && values.plannedDashed ? '6 5' : undefined,
    };
  }
  function workTitle(work) {
    return values.workLabelContent === 'code'
      ? work.code + ' · ' + work.title
      : values.workLabelContent === 'dates'
        ? work.title + ' · ' + work.start + '〜' + work.end
        : work.title;
  }
  function assetTitle(asset) {
    return values.equipmentLabelContent === 'code'
      ? asset.code
      : values.equipmentLabelContent === 'both'
        ? asset.code + ' · ' + asset.name
        : asset.name;
  }
  function bindWork(layer, work) {
    if (values.workLabels !== 'none') {
      FactoryMedia.bindHover(layer, work, workTitle(work), {
        kind: 'work',
        permanent: values.workLabels === 'always',
        direction: 'top',
        className: `work-label ${work.status === 'active' ? 'active-label' : ''}`,
        opacity: values.workLabelOpacity / 100,
      });
    }
    trackWork(layer);
  }
  function bindAsset(layer, asset) {
    layer.options.presentationColor =
      values.equipmentColors === 'single'
        ? values.equipmentColor
        : values.equipmentColors === 'layer'
          ? app?.state.layers?.find((l) => l.id === asset.layerId)?.color
          : null;
    if (values.equipmentLabels !== 'none') {
      FactoryMedia.bindHover(layer, asset, assetTitle(asset), {
        permanent: values.equipmentLabels === 'always',
        className:
          values.equipmentLabels === 'always' ? 'equipment-label' : 'equipment-photo-tooltip',
        direction: 'top',
        opacity: 1,
      });
    }
    trackAsset(layer);
  }
  function configure(input) {
    values = FactoryAppearance.normalize(input);
    if (!map) {
      return;
    }
    const node = map.getContainer();
    node.style.setProperty('--map-background', values.background);
    node.style.setProperty('--map-grid-size', values.gridSize + 'px');
    node.dataset.mapGrid = values.grid;
    node.style.setProperty('--drawing-opacity', values.drawingOpacity / 100);
    document.body.style.setProperty('--list-pane-width', values.leftWidth + 'px');
    document.body.style.setProperty('--detail-pane-width', values.rightWidth + 'px');
    document.body.dataset.lockBadges = String(values.lockBadges);
    document.body.dataset.equipmentShape = values.equipmentShape;
    document.body.dataset.noteShadow = String(values.noteShadow);
    node.style.setProperty('--note-opacity', values.noteOpacity / 100);
    for (const [selector, show] of [
      ['.summary-grid', values.summary],
      ['.bottom-note', values.footer],
      ['.north-arrow', values.north],
      ['.map-caption>span:first-child', values.legend],
      ['.leaflet-control-scale', values.scaleBar],
      ['.leaflet-control-zoom', values.zoomButtons],
      ['#map-coordinates', values.coordinates],
    ]) {
      document.querySelectorAll(selector).forEach((el) => (el.hidden = !show));
    }
    for (const [handler, enabled] of [
      ['scrollWheelZoom', values.wheelZoom],
      ['doubleClickZoom', values.doubleClickZoom],
    ]) {
      if (enabled) {
        map[handler].enable();
      } else {
        map[handler].disable();
      }
    }
    map.zoomControl.setPosition(values.zoomPosition);
    app.render();
    refresh();
  }
  function setup(instance) {
    app = instance;
    map = instance.map;
    if (!map.getPane('baseDrawingPane')) {
      map.createPane('baseDrawingPane').style.zIndex = 250;
    }
    const coords = document.createElement('output');
    coords.id = 'map-coordinates';
    coords.className = 'map-coordinates';
    coords.hidden = true;
    coords.setAttribute('aria-label', '図面座標');
    map.getContainer().append(coords);
    map.on('mousemove', (e) => {
      if (values.coordinates) {
        coords.textContent = `X ${e.latlng.lng.toFixed(1)} / Y ${e.latlng.lat.toFixed(1)}`;
      }
    });
    map.on('zoom zoomend', () => refresh());
    map.on('zoomanim', (e) => refresh(e.zoom));
    map.on('moveend', () => refresh());
  }
  return {
    setup,
    configure,
    settings,
    factor,
    iconPixels,
    clear,
    setDrawing,
    workStyle,
    bindWork,
    bindAsset,
    refresh,
    allowWork: (work) => values.showCompleted || work.status !== 'done',
  };
})();
