const axios = require('axios');
const cheerio = require('cheerio');
const _ = require('lodash');
const fs = require('fs');
const csv = require('csv-parser');
const yahooFinance = require('yahoo-finance2').default;
const math = require('mathjs');
let priceCache = {};


// Fetch S&P 500 tickers from Wikipedia
async function fetchSP500Tickers() {
  const url = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';

  try {
      // Fetch the HTML content of the page
      const response = await axios.get(url);
      
      // Load the HTML into Cheerio
      const $ = cheerio.load(response.data);
      
      // Find the table containing the tickers
      const tickers = [];

      // Loop through the rows of the table and extract the ticker symbols
      $('table.wikitable tbody tr').each((index, element) => {
          const ticker = $(element).find('td:nth-child(1) a').text().trim();
          if (ticker) {
              tickers.push(ticker);
          }
      });

     
      return tickers;

  } catch (error) {
      console.error('Error fetching S&P 500 tickers:', error.message);
      return [];
  }
}

// Fetch penny stock tickers from a CSV file (using dummy data here)

function fetchPennyStockTickers() {
  return new Promise((resolve, reject) => {
      const tickers = [];

      // Read the CSV file and parse it
      fs.createReadStream('./stocks/penny_stocks.csv')
          .pipe(csv())
          .on('data', (row) => {
              // Assuming the ticker is in the first column of the CSV file (index 0)
              tickers.push(row[Object.keys(row)[0]]);
          })
          .on('end', () => {
              resolve(tickers); // Return the list of tickers as a promise
          })
          .on('error', (error) => {
              reject(error); // Reject the promise on error
          });
  });
}

// Fetch stock data (you may need to use a stock API for this)
function rollingMean(arr, windowSize) {
  return arr.map((_, i, arr) => {
      if (i + 1 >= windowSize) {
          const window = arr.slice(i + 1 - windowSize, i + 1);
          return math.mean(window);
      } else {
          return null;
      }
  });
}

// Helper function to calculate rolling standard deviation
function rollingStd(arr, windowSize) {
  return arr.map((_, i, arr) => {
      if (i + 1 >= windowSize) {
          const window = arr.slice(i + 1 - windowSize, i + 1);
          return math.std(window);
      } else {
          return null;
      }
  });
}

// Helper function to calculate RSI (Relative Strength Index)
function calculateRSI(prices, period = 14) {
  const gains = [];
  const losses = [];
  for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) {
          gains.push(change);
          losses.push(0);
      } else {
          losses.push(-change);
          gains.push(0);
      }
  }

  const avgGain = math.mean(gains.slice(0, period));
  const avgLoss = math.mean(losses.slice(0, period));

  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  return rsi;
}
async function candleStickRecords(symbol) {
    try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 100);

        const queryOptions = {
            period1: startDate,
            period2: endDate,
            interval: '1d'
        };

        const [historyResult, quoteResult] = await Promise.all([
            yahooFinance.historical(symbol, queryOptions),
            yahooFinance.quote(symbol)
        ]);

        // Function to identify local peaks and troughs
        const findSignals = (data, windowSize = 5) => {
            return data.map((item, index, array) => {
                if (index < windowSize || index > array.length - windowSize - 1) return null;

                const window = array.slice(index - windowSize, index + windowSize + 1);
                const currentPrice = item.close;

                // Check if current point is a local maximum (sell signal)
                const isLocalMax = window.every(p => p.close <= currentPrice);
                
                // Check if current point is a local minimum (buy signal)
                const isLocalMin = window.every(p => p.close >= currentPrice);

                if (isLocalMax) return 'sell';
                if (isLocalMin) return 'buy';
                return null;
            });
        };

        const candlestickData = historyResult.map((item, index, array) => {
            const baseData = {
                time: item.date.toISOString().split('T')[0],
                open: item.open,
                high: item.high,
                low: item.low,
                close: item.close,
                volume: item.volume,
                candleColor: item.close > item.open ? '#22c55e' : '#ef4444'
            };

            const priceChange = item.close - item.open;
            const priceChangePercent = (priceChange / item.open) * 100;
            const bodyLength = Math.abs(item.close - item.open);
            const upperShadow = item.high - Math.max(item.open, item.close);
            const lowerShadow = Math.min(item.open, item.close) - item.low;

            const isHammer = lowerShadow > (2 * bodyLength) && upperShadow <= (0.1 * bodyLength);
            const isInvertedHammer = upperShadow > (2 * bodyLength) && lowerShadow <= (0.1 * bodyLength);
            const isDoji = bodyLength <= (0.1 * (item.high - item.low));

            let volumeChange = 0;
            let averageVolume = 0;
            if (index > 0) {
                volumeChange = ((item.volume - array[index - 1].volume) / array[index - 1].volume) * 100;
                const volumeSum = array.slice(Math.max(0, index - 5), index).reduce((sum, curr) => sum + curr.volume, 0);
                averageVolume = volumeSum / Math.min(5, index);
            }

            const dayRange = ((item.high - item.low) / item.low) * 100;

            return {
                ...baseData,
                analysis: {
                    priceChange: Number(priceChange.toFixed(2)),
                    priceChangePercent: Number(priceChangePercent.toFixed(2)),
                    bodyLength: Number(bodyLength.toFixed(2)),
                    upperShadow: Number(upperShadow.toFixed(2)),
                    lowerShadow: Number(lowerShadow.toFixed(2)),
                    patterns: {
                        isHammer,
                        isInvertedHammer,
                        isDoji
                    },
                    volume: {
                        change: Number(volumeChange.toFixed(2)),
                        averageVolume: Math.round(averageVolume),
                        aboveAverage: item.volume > averageVolume
                    },
                    volatility: Number(dayRange.toFixed(2))
                }
            };
        });

        // Calculate buy/sell signals
        const signals = findSignals(candlestickData);

        // Calculate moving averages
        const calculateMA = (data, period) => {
            return data.map((_, index) => {
                if (index < period - 1) return null;
                const slice = data.slice(index - (period - 1), index + 1);
                const average = slice.reduce((sum, item) => sum + item.close, 0) / period;
                return Number(average.toFixed(2));
            });
        };

        const ma20 = calculateMA(candlestickData, 20);
        const ma50 = calculateMA(candlestickData, 50);
        const ma200 = calculateMA(candlestickData, 200);

        // Add moving averages and signals to the data
        const enrichedData = candlestickData.map((item, index) => ({
            ...item,
            technicals: {
                ma20: ma20[index],
                ma50: ma50[index],
                ma200: ma200[index],
                signal: signals[index]
            }
        }));

        const currentPrice = quoteResult.regularMarketPrice;
        const lastMA20 = ma20[ma20.length - 1];
        const lastMA50 = ma50[ma50.length - 1];
        const marketTrend = currentPrice > lastMA50 ? 'bullish' : 
                           currentPrice < lastMA50 ? 'bearish' : 'neutral';

        const recentPrices = candlestickData.slice(-20);
        const highestPrice = Math.max(...recentPrices.map(d => d.high));
        const lowestPrice = Math.min(...recentPrices.map(d => d.low));
        const priceRange = highestPrice - lowestPrice;
        const volatility = recentPrices.reduce((sum, d) => sum + d.analysis.volatility, 0) / 20;

        const volatilityFactor = volatility / 100;
        const entryPoint = currentPrice - (priceRange * Math.min(0.1, volatilityFactor));
        const exitPoint = currentPrice + (priceRange * Math.max(0.2, volatilityFactor * 2));
        const stopLoss = entryPoint - (priceRange * Math.min(0.05, volatilityFactor / 2));

        // Get the latest signal
        const latestSignal = signals.filter(s => s !== null).pop() || 'hold';

        return {
            symbol,
            name: quoteResult.longName,
            candlestickData: enrichedData,
            currentPrice,
            averageVolume: quoteResult.averageVolume,
            signals: {
                entryPoint: Number(entryPoint.toFixed(2)),
                exitPoint: Number(exitPoint.toFixed(2)),
                stopLoss: Number(stopLoss.toFixed(2)),
                marketTrend,
                volatility: Number(volatility.toFixed(2)),
                currentSignal: latestSignal
            },
            metadata: {
                currency: quoteResult.currency,
                exchange: quoteResult.exchange,
                marketCap: quoteResult.marketCap,
                lastUpdated: new Date().toISOString()
            }
        };

    } catch (error) {
        console.error(`Error fetching data for ${symbol}:`, error);
        throw new Error(`Failed to fetch stock data for ${symbol}: ${error.message}`);
    }
}
async function candleStickRecordsForDayTrading(ticker) {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const findSignals = (data, windowSize = 5) => {
        return data.map((item, index, array) => {
            if (index < windowSize || index > array.length - windowSize - 1) return null;

            const window = array.slice(index - windowSize, index + windowSize + 1);
            const currentPrice = item.close;

            // Check if current point is a local maximum (sell signal)
            const isLocalMax = window.every(p => p.close <= currentPrice);
            
            // Check if current point is a local minimum (buy signal)
            const isLocalMin = window.every(p => p.close >= currentPrice);

            if (isLocalMax) return 'sell';
            if (isLocalMin) return 'buy';
            return null;
        });
    };
    const queryOptions = {
      period1: twentyFourHoursAgo,
      period2: now,
      interval: '15m',
      return: 'array'
    };
  
    try {
    //   const result = await yahooFinance.chart(ticker, queryOptions);
      const [historyResult, quoteResult] = await Promise.all([
        yahooFinance.chart(ticker, queryOptions),
        yahooFinance.quote(ticker)
    ]);
    const candlestickData = historyResult.quotes.map((item, index, array) => {
        // Calculate basic candle data
        const baseData = {
            time: item.date.toISOString(),
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
            volume: item.volume,
            candleColor: item.close > item.open ? '#22c55e' : '#ef4444'
        };

        // Calculate price change and percentage
        const priceChange = item.close - item.open;
        const priceChangePercent = (priceChange / item.open) * 100;

        // Calculate body and shadow lengths
        const bodyLength = Math.abs(item.close - item.open);
        const upperShadow = item.high - Math.max(item.open, item.close);
        const lowerShadow = Math.min(item.open, item.close) - item.low;

        // Determine candle patterns
        const isHammer = lowerShadow > (2 * bodyLength) && upperShadow <= (0.1 * bodyLength);
        const isInvertedHammer = upperShadow > (2 * bodyLength) && lowerShadow <= (0.1 * bodyLength);
        const isDoji = bodyLength <= (0.1 * (item.high - item.low));

        // Volume analysis
        let volumeChange = 0;
        let averageVolume = 0;
        if (index > 0) {
            volumeChange = ((item.volume - array[index - 1].volume) / array[index - 1].volume) * 100;
            const volumeSum = array.slice(Math.max(0, index - 5), index).reduce((sum, curr) => sum + curr.volume, 0);
            averageVolume = volumeSum / Math.min(5, index);
        }

        // Volatility (based on high-low range)
        const dayRange = ((item.high - item.low) / item.low) * 100;

        return {
            ...baseData,
            analysis: {
                priceChange: Number(priceChange.toFixed(2)),
                priceChangePercent: Number(priceChangePercent.toFixed(2)),
                bodyLength: Number(bodyLength.toFixed(2)),
                upperShadow: Number(upperShadow.toFixed(2)),
                lowerShadow: Number(lowerShadow.toFixed(2)),
                patterns: {
                    isHammer,
                    isInvertedHammer,
                    isDoji
                },
                volume: {
                    change: Number(volumeChange.toFixed(2)),
                    averageVolume: Math.round(averageVolume),
                    aboveAverage: item.volume > averageVolume
                },
                volatility: Number(dayRange.toFixed(2))
            }
        };
    });
    const signals = findSignals(candlestickData);
    // Calculate multiple moving averages
    const calculateMA = (data, period) => {
        return data.map((_, index) => {
            if (index < period - 1) return null;
            const slice = data.slice(index - (period - 1), index + 1);
            const average = slice.reduce((sum, item) => sum + item.close, 0) / period;
            return Number(average.toFixed(2));
        });
    };

    const ma20 = calculateMA(candlestickData, 20);
    const ma50 = calculateMA(candlestickData, 50);
    const ma200 = calculateMA(candlestickData, 200);

    // Add moving averages to the data
    const enrichedData = candlestickData.map((item, index) => ({
        ...item,
        technicals: {
            ma20: ma20[index],
            ma50: ma50[index],
            ma200: ma200[index],
            signal: signals[index]
        }
    }));

    // Current market conditions and trend analysis
    const currentPrice = quoteResult.regularMarketPrice;
    const lastMA20 = ma20[ma20.length - 1];
    const lastMA50 = ma50[ma50.length - 1];
    const marketTrend = currentPrice > lastMA50 ? 'bullish' : 
                       currentPrice < lastMA50 ? 'bearish' : 'neutral';

    // Enhanced entry/exit points calculation
    const recentPrices = candlestickData.slice(-20);
    const highestPrice = Math.max(...recentPrices.map(d => d.high));
    const lowestPrice = Math.min(...recentPrices.map(d => d.low));
    const priceRange = highestPrice - lowestPrice;
    const volatility = recentPrices.reduce((sum, d) => sum + d.analysis.volatility, 0) / 20;

    // Adjust entry/exit points based on volatility
    const volatilityFactor = volatility / 100;
    const entryPoint = currentPrice - (priceRange * Math.min(0.1, volatilityFactor));
    const exitPoint = currentPrice + (priceRange * Math.max(0.2, volatilityFactor * 2));
    const stopLoss = entryPoint - (priceRange * Math.min(0.05, volatilityFactor / 2));

    return {
        symbol:ticker,
        name: quoteResult.longName,
        candlestickData: enrichedData,
        currentPrice,
        averageVolume: quoteResult.averageVolume,
        signals: {
            entryPoint: Number(entryPoint.toFixed(2)),
            exitPoint: Number(exitPoint.toFixed(2)),
            stopLoss: Number(stopLoss.toFixed(2)),
            marketTrend,
            volatility: Number(volatility.toFixed(2))
        },
        metadata: {
            currency: quoteResult.currency,
            exchange: quoteResult.exchange,
            marketCap: quoteResult.marketCap,
            lastUpdated: new Date().toISOString()
        }
    };
    } catch (error) {
        console.error(`Error fetching data for ${ticker}:`, error);
        throw new Error(`Failed to fetch stock data for ${ticker}: ${error.message}`);
    }
  }


// Fetch stock data from Yahoo Finance
async function fetchCarouselTickers(tickers) {
    const results = [];
    const errors = [];
   
    // Process tickers in parallel
    const promises = tickers.map(async (ticker) => {
        try {
            const stock = await yahooFinance.quote(ticker);
            
            // Calculate change percentage using regularMarketPrice and regularMarketOpen
            const changePercent = stock.regularMarketOpen 
                ? ((stock.regularMarketPrice - stock.regularMarketOpen) / stock.regularMarketOpen * 100).toFixed(2)
                : null;

            // Create record with the requested fields including change percentage
            const record = {
                ticker,
                name: stock.longName || null,
                volume: stock.regularMarketVolume || null,
                price: stock.regularMarketPrice?.toFixed(2) || null,
                market_cap: stock.marketCap || null,
                pe_ratio: stock.trailingPE || null,
                change_percent: changePercent || stock.regularMarketChangePercent?.toFixed(2) || null
            };

            // Check if any fields are null
            const hasNullValues = Object.values(record).some(value => 
                value === null || value === undefined || value === 'NaN'
            );

            if (!hasNullValues) {
                results.push(record);
            }

        } catch (error) {
            errors.push(`Error fetching stock data for ${ticker}: ${error.message}`);
        }
    });

    // Wait for all promises to resolve
    await Promise.all(promises);

    // Log errors but don't let them affect the response
    if (errors.length) {
        console.error('Errors encountered:', errors);
    }

    // Return exactly 10 valid records
    return results;
}

async function fetchStockData(ticker) {
  try {
      const stock = await yahooFinance.quote(ticker);
      let period1 = Math.floor(new Date().setFullYear(new Date().getFullYear() - 1) / 1000); // 1 year ago
      const period2 = Math.floor(Date.now() / 1000);  // Current date
      const queryOptions = {
        period1: period1,
        period2: period2,
        interval: '1d',  // Daily data
      };
  
      // Attempt to fetch historical data for the past year
      let history = await yahooFinance.chart(ticker, queryOptions);
  
      // Check if the data is empty and, if so, retry with a shorter period
      if (!history || !history.quotes || history.quotes.length === 0) {
        // console.log(`No 1-year data found for ${ticker}. Fetching data for the past 6 months...`);
        
        // Calculate 6 months ago from now
        period1 = Math.floor(new Date().setMonth(new Date().getMonth() - 6) / 1000); // 6 months ago
        history = await yahooFinance.chart(ticker, { period1, period2, interval: '1d' });
  
        // If still empty, log an error
        if (!history || !history.quotes || history.quotes.length === 0) {
          throw new Error(`No historical data found for ${ticker}`);
        }
      }

      // Extract the quotes data
      const quotes = history.quotes;
      
      // Extract the closing prices, volume, and open prices
      const closingPrices = quotes.map(item => item.close);
      const volume = quotes.map(item => item.volume);
      const openPrices = quotes.map(item => item.open);
     
      // Calculating moving averages, RSI, and Bollinger Bands
      const ma50 = rollingMean(closingPrices, 50);
      const ma200 = rollingMean(closingPrices, 200);
      const rsi = closingPrices.slice(14).map((_, i) => calculateRSI(closingPrices.slice(i, i + 14)));
      const ma20 = rollingMean(closingPrices, 20);
      const std20 = rollingStd(closingPrices, 20);
      const upperBB = ma20.map((m, i) => m + (2 * (std20[i] || 0)));
      const lowerBB = ma20.map((m, i) => m - (2 * (std20[i] || 0)));

      const currentPrice = stock.regularMarketPrice;
      const entryExitPoints = calculateEntryExitPoints(ticker, currentPrice, lowerBB[lowerBB.length - 1], upperBB[upperBB.length - 1]);
      

// Ensure the arrays are of the same length and aligned:
if (closingPrices.length !== openPrices.length) {
    console.error("Mismatch in open and close prices");
    return null;
}

const change_percent = ((closingPrices[closingPrices.length - 1] - openPrices[openPrices.length - 1]) / openPrices[openPrices.length - 1]) * 100;
      return {
          ticker,
          name: stock.longName || 'N/A',
          volume: volume[volume.length - 1],
          price: currentPrice.toFixed(2),
          market_cap: stock.marketCap || 0,
          pe_ratio: stock.trailingPE || null,
          change_percent,
          '50_MA': ma50[ma50.length - 1]?.toFixed(2),
          '200_MA': ma200[ma200.length - 1]?.toFixed(2),
          'RSI': rsi[rsi.length - 1]?.toFixed(2),
          'Upper_BB': upperBB[upperBB.length - 1]?.toFixed(2),
          'Lower_BB': lowerBB[lowerBB.length - 1]?.toFixed(2),
          entry_point: entryExitPoints.entryPoint.toFixed(2),
          exit_point: entryExitPoints.exitPoint.toFixed(2),
        //   closingPrices,
        //   openPrices
      };
  } catch (error) {
      console.error(`Error fetching stock data for ${ticker}:`, error.message);
      return null;
  }
}



function calculateEntryExitPoints(ticker, currentPrice, lowerBB, upperBB) {
  // Check if we already have stored prices for this ticker
  if (priceCache[ticker]) {
      const [lastEntry, lastExit, lastPrice] = priceCache[ticker];
      
      // Only update if the price has changed significantly (1% change threshold)
      if (Math.abs(currentPrice - lastPrice) / lastPrice < 0.01) {
          return { entryPoint: lastEntry, exitPoint: lastExit };
      }
  }

  // Randomly decide if the entry point should be above or below the current price
  let entryPoint;
  if (Math.random() < 0.5) {
      // Slightly above (1-3%)
      entryPoint = currentPrice * (1 + (Math.random() * 0.02 + 0.01));
  } else {
      // Slightly below (1-3%)
      entryPoint = currentPrice * (1 - (Math.random() * 0.02 + 0.01));
  }

  // Set the exit point to be higher than the current price (e.g., 5-10% above)
  const exitPoint = currentPrice * (1 + (Math.random() * 0.05 + 0.05));

  // Update the cache
  priceCache[ticker] = [round(entryPoint, 6), round(exitPoint, 6), currentPrice];

  return {
      entryPoint: round(entryPoint, 2),
      exitPoint: round(exitPoint, 2),
  };
}



function round(value, precision) {
  if (typeof value !== 'number' || isNaN(value)) {
      return null; // Return null if the value is not a valid number
  }
  return parseFloat(value.toFixed(precision));
}




// Round price value for consistency
function formatPrice(price) {
    if (price < 0.01 && price > 0) {
        return round(price, 6);
    }
    return round(price, 2);
}




// Main function to filter stocks based on conditions
async function fetchTickers(){
    
  const sp500Tickers = [
    "AAPL", // Apple Inc.
    "MSFT", // Microsoft Corporation
    "NVDA", // NVIDIA Corporation
    "GOOGL", // Alphabet Inc.
    "AMZN", // Amazon.com, Inc.
    "TSLA", // Tesla, Inc.
    "BRK.B", // Berkshire Hathaway Inc.
    "META", // Meta Platforms, Inc.
    "UNH", // UnitedHealth Group Incorporated
    "JNJ", // Johnson & Johnson
    "PG", // Procter & Gamble Co.
    "XOM", // Exxon Mobil Corporation
    "CVX", // Chevron Corporation
    "WMT", // Walmart Inc.
    "PFE", // Pfizer Inc.
    "V", // Visa Inc.
    "MA", // Mastercard Incorporated
    "KO", // Coca-Cola Company
    "PEP", // PepsiCo, Inc.
    "ABBV" // AbbVie Inc.
  ]
  ;

  const sp500StockData = await fetchCarouselTickers(sp500Tickers);
  return {
  
    sp500Stocks:sp500StockData
  }
}
async function filterStocks() {
  const pennyTickers = await fetchPennyStockTickers();
  const sp500Tickers = await fetchSP500Tickers();

  const pennyStockData = await Promise.all(pennyTickers.map(fetchStockData));
  const sp500StockData = await Promise.all(sp500Tickers.map(fetchStockData));

  const pennyStocksFiltered = pennyStockData.filter(stock => stock && stock.price >= 0.001);
  const sp500StocksFiltered = sp500StockData.filter(stock => stock && stock.price >= 0.001);

  // Day Trading Stocks (Volume-based)
  const dayTradingStocks = pennyStocksFiltered
      .filter(stock => stock.volume >= 1000000)
      .sort((a, b) => b.change_percent - a.change_percent)
      .slice(0, 5);

  // Swing Trading Stocks (MA-based)
  const swingTradingStocks = sp500StocksFiltered
      .filter(stock => stock['50_MA'] > stock['200_MA'] && stock.price >= 10 && stock.price <= 1000)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5);

  // Long-Term Stocks (PE Ratio and Market Cap-based)
  const longTermStocks = sp500StocksFiltered
      .filter(stock => stock.market_cap > 1000000000 && stock.pe_ratio && stock.pe_ratio < 20)
      .sort((a, b) => b.market_cap - a.market_cap)
      .slice(0, 5);

  return {
      'Day Trading': dayTradingStocks,
      'Swing Trading': swingTradingStocks,
      'Long Term': longTermStocks
  };
}



module.exports = {filterStocks,fetchStockData,fetchPennyStockTickers,fetchPennyStockTickers,fetchSP500Tickers,fetchTickers,fetchCarouselTickers,candleStickRecords,candleStickRecordsForDayTrading};
