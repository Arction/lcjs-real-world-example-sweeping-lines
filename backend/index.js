import WebSocket from "../node_modules/ws/index.js";

const wss = new WebSocket.Server({ port: 8081 });
let connection;
let chartCount;
let dataRateHz;
wss.on("connection", (ws) => {
  connection = ws;
  ws.onmessage = (e) => {
    const info = JSON.parse(e.data);
    chartCount = info.chartCount;
    dataRateHz = info.dataRateHz;
    console.log({ chartCount, dataRateHz });
  };
  ws.addEventListener("close", (e) => {
    connection = undefined;
  });
});

let tLastDataSend = performance.now();
setInterval(() => {
  if (!connection || !chartCount || !dataRateHz) {
    return;
  }

  const tNow = performance.now();
  const tDelta = tNow - tLastDataSend;
  const pushDataPointCount = Math.ceil((dataRateHz * tDelta) / 1000);
  const dataAllChannels = new Array(chartCount).fill(0).map((_) => {
    const xValues = new Array(pushDataPointCount);
    const yValues = new Array(pushDataPointCount);
    for (let i = 0; i < pushDataPointCount; i += 1) {
      const x = tLastDataSend + ((i + 1) / pushDataPointCount) * tDelta;
      const y = Math.random();
      xValues[i] = x;
      yValues[i] = y;
    }
    return [xValues, yValues];
  });
  tLastDataSend = tNow;
  const msg = encodeMultiChannelArrXY(dataAllChannels);
  connection.send(msg);
}, 1000 / 60);

// NOTE: Extract from LightningChart JS data transfer library
// https://lightningchart.com/js-charts/docs/basic-topics/real-time-data/websocket/#data-transfer-library
/**
 * Server has data for `n` channels in form `xValues: number[]; yValues: number[]` or `xValues: Float32Array; yValues: Float32Array`.
 * This method packs the data into a binary message that can be decoded back on client side and supplied to each channel individually.
 * Supports each channel having individual number of data points, even 0.
 *
 * @param       {Array<[ Array<number> | Float32Array, Array<number> | Float32Array ]>} dataAllChannels - List with data points for `n` channels. Each channel has separate array for X and Y values.
 * @returns     {ArrayBuffer} Binary message that can be sent over WebSocket or equivalent. Has to be decoded with respective client side method.
 */
const encodeMultiChannelArrXY = (dataAllChannels) => {
  const channelCount = dataAllChannels.length;
  const channelSampleCounts = dataAllChannels.map((chData) => chData[0].length);
  const totalSampleCount = channelSampleCounts.reduce(
    (prev, cur) => prev + cur,
    0
  );
  // Because each channel might have different number of data points, this encodeting requires additional meta data
  // (data that exists only for the purpose of managing the transfer of ACTUAL data).
  // This meta data is prefixed in the start of the binary message as:
  //      [1 float]: number of channels
  //      [1 float for every channel]: number of samples for channel `i`
  const metaDataNumbers = 1 + channelCount;
  const msg = new Float32Array(metaDataNumbers + totalSampleCount * 2);
  msg[0] = channelCount;
  for (let i = 0; i < channelCount; i += 1) {
    msg[1 + i] = channelSampleCounts[i];
  }
  let iMsg = 1 + channelCount;
  dataAllChannels.forEach((chData, i) => {
    msg.set(chData[0], iMsg);
    iMsg += channelSampleCounts[i];
    msg.set(chData[1], iMsg);
    iMsg += channelSampleCounts[i];
  });
  return msg;
};
