/// <reference path="lcjs.iife.d.ts" />
const {
  lightningChart,
  Themes,
  AxisScrollStrategies,
  AxisTickStrategies,
  emptyLine,
  ColorHEX,
  SolidFill,
  AutoCursorModes,
  PointShape,
  ColorCSS,
} = lcjs;

const chartCount = 24;
const xViewMs = 10 * 1000;
const dataRateHz = 1000; // NOTE: Alters "density" of data points. How many data points are sent in 1 second.

if (!window.WebSocket) {
  console.alert("Websocket not supported by browser.");
  throw new Error("Websocket not supported by browser.");
}
const ws = new WebSocket("ws://localhost:8081");
ws.addEventListener("open", (e) => {
  ws.send(JSON.stringify({ chartCount, dataRateHz }));
});

const lc = lightningChart({
  // Get license at https://lightningchart.com/js-charts
  license: undefined,
});
const dashboardDiv = document.getElementsByClassName("dashboard")[0];
const theme = { ...Themes.darkGold, effect: undefined };
const ecgBackgroundFill = new SolidFill({
  color: theme.isDark ? ColorHEX("#000000") : ColorHEX("#ffffff"),
});
const channels = new Array(chartCount).fill(0).map((_, iCh) => {
  const container = document.createElement("div");
  dashboardDiv.append(container);
  container.className = "chart";
  const chart = lc
    .ChartXY({ container, theme })
    .setTitle("")
    .setPadding(5)
    .setAutoCursorMode(AutoCursorModes.disabled)
    .setSeriesBackgroundFillStyle(ecgBackgroundFill)
    .setBackgroundFillStyle(ecgBackgroundFill)
    .setMouseInteractions(false)
    .setSeriesBackgroundStrokeStyle(emptyLine);

  const axisX = chart
    .getDefaultAxisX()
    .setTickStrategy(AxisTickStrategies.Empty)
    .setStrokeStyle(emptyLine)
    .setScrollStrategy(undefined)
    .setInterval({ start: 0, end: xViewMs, stopAxisAfter: false });

  const axisY = chart
    .getDefaultAxisY()
    .setStrokeStyle(emptyLine)
    .setTickStrategy(AxisTickStrategies.Empty);

  // Series for displaying "old" data.
  const seriesRight = chart
    .addLineSeries({
      dataPattern: { pattern: "ProgressiveX" },
      automaticColorIndex: iCh,
    })
    .setHighlightOnHover(false);

  // Rectangle for hiding "old" data under incoming "new" data.
  const seriesOverlayRight = chart
    .addRectangleSeries()
    .setAutoScrollingEnabled(false);
  const figureOverlayRight = seriesOverlayRight
    .add({ x1: 0, y1: 0, x2: 0, y2: 0 })
    .setFillStyle(ecgBackgroundFill)
    .setStrokeStyle(emptyLine)
    .setMouseInteractions(false);

  // Series for displaying new data.
  const seriesLeft = chart
    .addLineSeries({
      dataPattern: { pattern: "ProgressiveX" },
      automaticColorIndex: iCh,
    })
    .setHighlightOnHover(false);

  const seriesHighlightLastPoints = chart
    .addPointSeries({ pointShape: PointShape.Circle })
    .setPointFillStyle(
      new SolidFill({ color: theme.examples.highlightPointColor })
    )
    .setPointSize(5);

  return {
    chart,
    seriesLeft,
    seriesRight,
    seriesOverlayRight,
    figureOverlayRight,
    seriesHighlightLastPoints,
    axisX,
    axisY,
  };
});

//
//
// Setup logic for pushing new data points into a "custom sweeping line chart".
// LightningChart JS does not provide built-in functionalities for sweeping line charts.
// This example shows how it is possible to implement a performant sweeping line chart, with a little bit of extra application complexity.
let prevPosX = 0;
/**
 * @param {Array<[Float32Array, Float32Array]>} dataAllChannels
 */
const handleIncomingData = (dataAllChannels) => {
  // Keep track of the latest X (time position), clamped to the sweeping axis range.
  let posX = 0;

  for (let iCh = 0; iCh < channels.length; iCh += 1) {
    const xValuesTimestamped = dataAllChannels[iCh][0];
    const yValues = dataAllChannels[iCh][1];
    const newDataPointsCount = xValuesTimestamped.length;
    const channel = channels[iCh];

    // NOTE: Incoming data points are timestamped, meaning their X coordinates can go outside sweeping axis interval.
    // Clamp timestamps onto the sweeping axis range.
    const xValuesSweeping = new Array(newDataPointsCount);
    for (let i = 0; i < newDataPointsCount; i += 1) {
      xValuesSweeping[i] = xValuesTimestamped[i] % xViewMs;
    }

    posX = Math.max(posX, xValuesSweeping[newDataPointsCount - 1]);

    // Check if the channel completes a full sweep (or even more than 1 sweep even though it can't be displayed).
    let fullSweepsCount = 0;
    let signPrev = false;
    for (let i = 0; i < newDataPointsCount; i += 1) {
      const sign = xValuesSweeping[i] < prevPosX;
      if (sign === true && sign !== signPrev) {
        fullSweepsCount += 1;
      }
      signPrev = sign;
    }

    if (fullSweepsCount > 1) {
      // The below algorithm is incapable of handling data input that spans over several full sweeps worth of data.
      // To prevent visual errors, reset sweeping graph and do not process the data.
      // This scenario is triggered when switching tabs or minimizing the example for extended periods of time.
      channel.seriesRight.clear();
      channel.seriesLeft.clear();
    } else if (fullSweepsCount === 1) {
      // Sweeping cycle is completed.
      // Categorize new data points into those belonging to current sweep and the next.
      let dataCurrentSweep = [[], []];
      let dataNextSweep = [[], []];
      for (let i = 0; i < newDataPointsCount; i += 1) {
        if (xValuesSweeping[i] <= prevPosX) {
          dataCurrentSweep = [xValuesSweeping.slice(0, i), yValues.slice(0, i)];
          dataNextSweep = [xValuesSweeping.slice(i + 1), yValues.slice(i + 1)];
          break;
        }
      }
      // Finish current sweep.
      channel.seriesLeft.addArraysXY(dataCurrentSweep[0], dataCurrentSweep[1]);
      // Swap left and right series.
      const nextLeft = channel.seriesRight;
      const nextRight = channel.seriesLeft;
      channel.seriesLeft = nextLeft;
      channel.seriesRight = nextRight;
      channel.seriesRight.setDrawOrder({ seriesDrawOrderIndex: 0 });
      channel.seriesOverlayRight.setDrawOrder({ seriesDrawOrderIndex: 1 });
      channel.seriesLeft.setDrawOrder({ seriesDrawOrderIndex: 2 });
      // Start sweeping from left again.
      channel.seriesLeft.clear();
      channel.seriesLeft.addArraysXY(dataNextSweep[0], dataNextSweep[1]);
    } else {
      // Append data to left.
      channel.seriesLeft.addArraysXY(xValuesSweeping, yValues);
    }

    // Highlight last data point.
    channel.seriesHighlightLastPoints.clear().add({
      x: xValuesSweeping[newDataPointsCount - 1],
      y: yValues[newDataPointsCount - 1],
    });
  }

  // Move overlays of old data to right locations.
  const overlayXStart = 0;
  const overlayXEnd = posX + xViewMs * 0.03;
  channels.forEach((channel) => {
    channel.figureOverlayRight.setDimensions({
      x1: overlayXStart,
      x2: overlayXEnd,
      y1: channel.axisY.getInterval().start,
      y2: channel.axisY.getInterval().end,
    });
  });

  prevPosX = posX;
};

//
//
// Setup data connection from websocket to `handleIncomingData`
ws.onmessage = (e) => {
  e.data.arrayBuffer().then((dataRaw) => {
    const data = decodeMultiChannelArrXY(dataRaw);
    handleIncomingData(data);
  });
};

// NOTE: Extract from LightningChart JS data transfer library
// https://lightningchart.com/js-charts/docs/basic-topics/real-time-data/websocket/#data-transfer-library
/**
 * Server has data for `n` channels in form `xValues: number[]; yValues: number[]` or `xValues: Float32Array; yValues: Float32Array`.
 * This method unpacks the binary message sent using the respective server method.
 * Supports each channel having individual number of data points, even 0.
 *
 * @param       {ArrayBuffer} msg - Binary message constructed by respective server side method.
 * @returns     {Array<[Float32Array, Float32Array]>} List with data points for `n` channels. Each channel has separate array for X and Y values.
 */
const decodeMultiChannelArrXY = (msg) => {
  const dataFlat = new Float32Array(msg);
  const channelCount = dataFlat[0];
  const channelSampleCounts = new Array(channelCount)
    .fill(0)
    .map((_, i) => dataFlat[1 + i]);
  const data = [];
  let iData = 1 + channelCount;
  for (let ch = 0; ch < channelCount; ch += 1) {
    const chSamplesCount = channelSampleCounts[ch];
    const xValues = dataFlat.subarray(iData, iData + chSamplesCount);
    iData += chSamplesCount;
    const yValues = dataFlat.subarray(iData, iData + chSamplesCount);
    iData += chSamplesCount;
    data.push([xValues, yValues]);
  }
  return data;
};

//
//
//
// Measure and display FPS
(() => {
  let tStart = Date.now();
  let frames = 0;
  let fps = 0;
  const displayTitleChart = channels[0].chart
    .setTitlePosition("series-left-top")
    .setTitleMargin({ top: -8, left: -8 })
    .setTitleFont((font) => font.setSize(16))
    .setTitleFillStyle(new SolidFill({ color: ColorCSS("red") }));
  const recordFrame = () => {
    frames++;
    const tNow = Date.now();
    fps = 1000 / ((tNow - tStart) / frames);
    requestAnimationFrame(recordFrame);
    displayTitleChart.setTitle(`${fps.toFixed(1)} FPS`);
  };
  requestAnimationFrame(recordFrame);
  setInterval(() => {
    tStart = Date.now();
    frames = 0;
  }, 5000);
})();
