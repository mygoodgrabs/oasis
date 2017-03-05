import { Meteor } from 'meteor/meteor';
import { Template } from 'meteor/templating';
import { moment } from 'meteor/momentjs:moment';
import { Session } from 'meteor/session';
import { BigNumber } from 'meteor/ethereum:web3';
import { _ } from 'meteor/underscore';
import { web3 } from 'meteor/makerotc:dapple';
import { Offers, Trades } from '/imports/api/offers';
import Chart from '/imports/utils/Chart.min';
import { formatNumber, removeOutliersFromArray } from '/imports/utils/functions';
import './chart.html';

const charts = [];
Session.set('depthChart', false);
Session.set('volumeChart', false);
Session.set('rendered', false);

let askPrices = []; // Array of ask prices
let bidPrices = []; // Array of bid prices
let askAmounts = { base: [], quote: [] }; // Array of ask amounts
let bidAmounts = { base: [], quote: [] }; // Array of bid amounts
const volumes = { base: {}, quote: {} };
let days = [];

Template.chart.viewmodel({
  currentChart: 'DEPTH',
  showDepth() {
    return this.currentChart() === 'DEPTH' ? '' : 'hidden';
  },
  showVolume() {
    return this.currentChart() === 'VOLUME' ? '' : 'hidden';
  },
  prepareTooltip(tooltip, canvasId) {
    let tooltipEl = document.getElementById('chartjs-tooltip');
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.id = 'chartjs-tooltip';
      document.body.appendChild(tooltipEl);
    }
    // Hide if no tooltip
    if (tooltip.opacity === 0) {
      tooltipEl.style.opacity = 0;
      return false;
    }
    // Set caret Position
    tooltipEl.classList.remove('above', 'below', 'no-transform');
    if (tooltip.yAlign) {
      tooltipEl.classList.add(tooltip.yAlign);
    } else {
      tooltipEl.classList.add('no-transform');
    }

    const position = document.getElementById(canvasId).getBoundingClientRect();
    tooltipEl.style.left = `${position.left + tooltip.caretX}px`;
    tooltipEl.style.top = `${position.top + document.body.scrollTop + tooltip.caretY}px`;
    tooltipEl.style.padding = `${tooltip.yPadding}px${tooltip.xPadding}px`;

    return tooltipEl;
  },
  fillDepthChart() {
    Meteor.defer(() => {
      if (Session.get('rendered') && typeof charts.depth === 'undefined') {
        const ctx = document.getElementById('market-chart-depth');
        charts.depth = new Chart(ctx, {
          type: 'line',
          data: {},
          options: {
            maintainAspectRatio: true,
            layout: {
              padding: 5,
            },
            tooltips: {
              enabled: false,
              mode: 'index',
              position: 'nearest',
              custom: (tooltip) => {
                const tooltipEl = this.prepareTooltip(tooltip, 'market-chart-depth');
                if (tooltipEl && tooltip.body) {
                  const price = tooltip.dataPoints[0].xLabel;
                  let type = null;
                  let quoteAmount = null;
                  let baseAmount = null;
                  let typeIndex = 0;
                  tooltip.dataPoints.forEach((object, key) => {
                    if (object.y === tooltip.caretY) {
                      typeIndex = key;
                    }
                  });
                  [type, quoteAmount] = tooltip.body[typeIndex].lines[0].split(': ');
                  if (type === 'Sell') {
                    quoteAmount = askAmounts.quote[askPrices.indexOf(price)];
                    baseAmount = askAmounts.base[askPrices.indexOf(price)];
                  } else {
                    quoteAmount = bidAmounts.quote[bidPrices.indexOf(price)];
                    baseAmount = bidAmounts.base[bidPrices.indexOf(price)];
                  }
                  quoteAmount = formatNumber(web3.fromWei(quoteAmount), 5);
                  baseAmount = formatNumber(web3.fromWei(baseAmount), 5);

                  tooltipEl.innerHTML =
                    `<div class="row-custom-tooltip">
                      <span class="left">Price</span>
                      <span class="right">${formatNumber(price, 5)}</span>
                    </div>
                    <div class="row-custom-tooltip middle">
                      <span class="left">SUM(${Session.get('quoteCurrency')})</span>
                      <span class="right">${quoteAmount}</span>
                    </div>
                    <div class="row-custom-tooltip">
                      <span class="left">SUM(${Session.get('baseCurrency')})</span>
                      <span class="right">${baseAmount}</span>
                    </div>`;

                  tooltipEl.style.opacity = 1;
                }
              },
            },
            legend: {
              display: false,
            },
            scales: {
              yAxes: [{
                ticks: {
                  beginAtZero: true,
                },
              }],
              xAxes: [{
                display: false,
              }],
            },
          },
        });
        Session.set('depthChart', true);
      }
    });

    if (Session.get('depthChart')
        && Session.get('isConnected') && !Session.get('outOfSync')
        && !Session.get('loading')) {
      askPrices = [];
      bidPrices = [];
      askAmounts = { base: [], quote: [] };
      bidAmounts = { base: [], quote: [] };
      const quoteCurrency = Session.get('quoteCurrency');
      const baseCurrency = Session.get('baseCurrency');
      let bids = Offers.find({ buyWhichToken: baseCurrency, sellWhichToken: quoteCurrency },
                                { sort: { bid_price_sort: 1 } }).fetch();
      let asks = Offers.find({ buyWhichToken: quoteCurrency, sellWhichToken: baseCurrency },
                                { sort: { ask_price_sort: 1 } }).fetch();

      bids = removeOutliersFromArray(bids, 'bid_price_sort', 3);
      asks = removeOutliersFromArray(asks, 'ask_price_sort', 3);

      asks.forEach(ask => {
        const index = askPrices.indexOf(ask.ask_price);
        if (index === -1) {
          // If it is the first order for this price

          // Keep track of new price index
          askPrices.push(ask.ask_price);

          if (askAmounts.quote.length > 0) {
            // If there is a lower price we need to sum the amount of the previous price (to make a cumulative graph)
            askAmounts.quote.push(askAmounts.quote[askAmounts.quote.length - 1].add(new BigNumber(ask.buyHowMuch)));
            askAmounts.base.push(askAmounts.base[askAmounts.base.length - 1].add(new BigNumber(ask.sellHowMuch)));
          } else {
            askAmounts.quote.push(new BigNumber(ask.buyHowMuch));
            askAmounts.base.push(new BigNumber(ask.sellHowMuch));
          }
        } else {
          // If there was already another offer for the same price we add the new amount
          askAmounts.quote[index] = askAmounts.quote[index].add(new BigNumber(ask.buyHowMuch));
          askAmounts.base[index] = askAmounts.base[index].add(new BigNumber(ask.sellHowMuch));
        }
      });

      bids.forEach(bid => {
        const index = bidPrices.indexOf(bid.bid_price);
        if (index === -1) {
          // If it is the first order for this price

          // Keep track of new price index and value
          bidPrices.push(bid.bid_price);
          bidAmounts.quote.push(new BigNumber(bid.sellHowMuch));
          bidAmounts.base.push(new BigNumber(bid.buyHowMuch));
        } else {
          bidAmounts.quote[index] = bidAmounts.quote[index].add(new BigNumber(bid.sellHowMuch));
          bidAmounts.base[index] = bidAmounts.base[index].add(new BigNumber(bid.buyHowMuch));
        }

        // It is necessary to update all the previous prices adding the actual amount (to make a cumulative graph)
        bidAmounts.quote = bidAmounts.quote.map((b, i) =>
                            ((i < bidAmounts.quote.length - 1) ? b.add(bid.sellHowMuch) : b));
        bidAmounts.base = bidAmounts.base.map((b, i) =>
                            ((i < bidAmounts.base.length - 1) ? b.add(bid.buyHowMuch) : b));
      });

      // All price values (bids & asks)
      const vals = _.uniq(bidPrices.concat(askPrices).sort((a, b) => {
        const val1 = new BigNumber(a);
        const val2 = new BigNumber(b);
        if (val1.lt(val2)) {
          return -1;
        }
        return 1;
      }));

      // Preparing arrays for graph
      const askAmountsGraph = [];
      const bidAmountsGraph = [];
      let index = null;
      let amount = null;

      for (let i = 0; i < vals.length; i++) {
        index = askPrices.indexOf(vals[i]);
        if (index !== -1) {
          // If there is a specific value for the price in asks, we add it
          amount = formatNumber(web3.fromWei(askAmounts.quote[index]), 3).replace(/,/g, '');
        } else if (askPrices.length === 0 ||
                  (new BigNumber(vals[i])).lt((new BigNumber(askPrices[0]))) ||
                  (new BigNumber(vals[i])).gt((new BigNumber(askPrices[askPrices.length - 1])))) {
          // If the price is lower or higher than the asks range there is not value to print in the graph
          amount = null;
        } else {
          // If there is not an ask amount for this price, we need to add the previous amount
          amount = askAmountsGraph[askAmountsGraph.length - 1];
        }
        askAmountsGraph.push({ x: vals[i], y: amount });

        index = bidPrices.indexOf(vals[i]);
        if (index !== -1) {
          // If there is a specific value for the price in bids, we add it
          amount = formatNumber(web3.fromWei(bidAmounts.quote[index]), 3).replace(/,/g, '');
        } else if (bidPrices.length === 0 ||
                  (new BigNumber(vals[i])).lt((new BigNumber(bidPrices[0]))) ||
                  (new BigNumber(vals[i])).gt((new BigNumber(bidPrices[bidPrices.length - 1])))) {
          // If the price is lower or higher than the bids range there is not value to print in the graph
          amount = null;
        } else {
          // If there is not a bid amount for this price, we need to add the next available amount
          for (let j = 0; j < bidPrices.length; j++) {
            if (bidPrices[j] >= vals[i]) {
              amount = formatNumber(web3.fromWei(bidAmounts.quote[j]), 3).replace(/,/g, '');
              break;
            }
          }
        }
        bidAmountsGraph.push({ x: vals[i], y: amount });
      }

      charts.depth.data.labels = vals;
      charts.depth.data.datasets = [
        {
          label: 'Buy',
          data: bidAmountsGraph,
          backgroundColor: 'rgba(38, 166, 154, 0.2)',
          borderColor: 'rgba(38, 166, 154, 1)',
          borderWidth: 3,
          // fill: false,
          pointStyle: 'circle',
          pointRadius: 3,
          pointBorderWidth: 1,
          pointBorderColor: '#1ABC9C',
          pointBackgroundColor: '#1ABC9C',
          hoverBackgroundColor: '#1ABC9C',
          hoverBorderColor: '#1ABC9C',
          hoverBorderWidth: 5,
          steppedLine: true,
          invertedStep: true,
        },
        {
          label: 'Sell',
          data: askAmountsGraph,
          backgroundColor: 'rgba(239, 83, 80, 0.2)',
          borderColor: '#EF5350',
          borderWidth: 3,
          // fill: false,
          pointStyle: 'circle',
          pointRadius: 3,
          pointBorderWidth: 1,
          pointBorderColor: '#EF5350',
          pointBackgroundColor: '#EF5350',
          hoverBackgroundColor: '#EF5350',
          hoverBorderColor: '#EF5350',
          hoverBorderWidth: 5,
          steppedLine: true,
        }];
      charts.depth.update();
    }
  },
  fillVolumeChart() {
    Meteor.defer(() => {
      if (Session.get('rendered') && typeof charts.volume === 'undefined') {
        const ctx = document.getElementById('market-chart-volume');
        charts.volume = new Chart(ctx, {
          type: 'line',
          data: {},
          options: {
            maintainAspectRatio: true,
            layout: {
              padding: 5,
            },
            tooltips: {
              enabled: false,
              mode: 'index',
              position: 'nearest',
              custom: (tooltip) => {
                const tooltipEl = this.prepareTooltip(tooltip, 'market-chart-volume');
                if (tooltipEl && tooltip.body) {
                  const date = parseInt(tooltip.dataPoints[0].xLabel, 10);
                  let quoteAmount = null;
                  let baseAmount = null;
                  quoteAmount = formatNumber(web3.fromWei(volumes.quote[date]), 5);
                  baseAmount = formatNumber(web3.fromWei(volumes.base[date]), 5);

                  tooltipEl.innerHTML =
                    `<div class="row-custom-tooltip">
                      <span class="left">Date</span>
                      <span class="right">${moment(date).format('ll')}</span>
                    </div>
                    <div class="row-custom-tooltip middle">
                      <span class="left">SUM(${Session.get('quoteCurrency')})</span>
                      <span class="right">${quoteAmount}</span>
                    </div>
                    <div class="row-custom-tooltip">
                      <span class="left">SUM(${Session.get('baseCurrency')})</span>
                      <span class="right">${baseAmount}</span>
                    </div>`;

                  tooltipEl.style.opacity = 1;
                }
              },
            },
            legend: {
              display: false,
            },
            scales: {
              yAxes: [{
                ticks: {
                  beginAtZero: true,
                },
              }],
              xAxes: [{
                display: false,
              }],
            },
          },
        });
        Session.set('volumeChart', true);
      }
    });

    if (Session.get('volumeChart')
        && !Session.get('loadingTradeHistory')) {
      const quoteCurrency = Session.get('quoteCurrency');
      const baseCurrency = Session.get('baseCurrency');
      let day = null;
      days = [];
      volumes.base = {};
      volumes.quote = {};
      for (let i = 6; i >= 0; i--) {
        day = moment(Date.now()).startOf('day').subtract(i, 'days');
        days.push(day);
        volumes.base[day.unix() * 1000] = new BigNumber(0);
        volumes.quote[day.unix() * 1000] = new BigNumber(0);
      }

      const trades = Trades.find({ $or: [
        { buyWhichToken: baseCurrency, sellWhichToken: quoteCurrency },
        { buyWhichToken: quoteCurrency, sellWhichToken: baseCurrency },
      ],
        timestamp: { $gte: days[0].unix() },
      });

      trades.forEach((trade) => {
        day = moment.unix(trade.timestamp).startOf('day').unix() * 1000;
        if (trade.buyWhichToken === quoteCurrency) {
          volumes.quote[day] = volumes.quote[day].add(new BigNumber(trade.buyHowMuch));
          volumes.base[day] = volumes.base[day].add(new BigNumber(trade.sellHowMuch));
        } else {
          volumes.quote[day] = volumes.quote[day].add(new BigNumber(trade.sellHowMuch));
          volumes.base[day] = volumes.base[day].add(new BigNumber(trade.buyHowMuch));
        }
      });

      charts.volume.data.labels = days;

      charts.volume.data.datasets = [{
        label: 'Volume',
        data: Object.keys(volumes.quote).map((key) =>
                                              formatNumber(web3.fromWei(volumes.quote[key]), 5).replace(/,/g, '')),
        backgroundColor: 'rgba(140, 133, 200, 0.1)',
        borderColor: '#8D86C9',
        borderWidth: 3,
        // fill: false,
        pointBackgroundColor: '#8D86C9',
        pointRadius: 3,
      }];

      charts.volume.update();
    }
  },
});

Template.chart.onRendered(() => {
  Session.set('rendered', true);
});
