

const cron = require("node-cron");
const CronExpression = require("./cron_expression");
var stock_types=["Entery", "Closing"]
var days = ["sunday","monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
var trading_types=["dayTrading", "swingTrading", "longTerm"]
var trading_shift_counter=0;
const pool= require('../db_config')
const {filterStocks,fetchStockData,fetchPennyStockTickers,fetchSP500Tickers,fetchTickers,candleStickRecords} = require('../services/stockDataService');
const prompts = [
    "AAPL is a bullish trade today because its technical indicators, including the Bollinger Bands, show the stock trading near its lower band, suggesting a potential bounce. The Relative Strength Index (RSI) is hovering near the oversold zone, indicating a buying opportunity. Additionally, the Moving Average Convergence Divergence (MACD) has recently crossed above its signal line, signaling momentum in the upward direction. With these indicators pointing towards a reversal, this stock appears to be an ideal buy right now.",
    "The bullish case for AAPL is supported by several key technical factors. This stock is currently approaching a strong support level, indicating potential resistance to further declines. The RSI suggests the stock is oversold, making it a prime candidate for a rebound. Moreover, the MACD histogram has begun to tick upward, signaling a shift in momentum. Combined with its historical strength, these technical indicators make this a promising buy today.",
    "AAPL is an attractive bullish trade today, particularly due to its technical setup. This stock has been respecting a critical support level, and the RSI is inching closer to the oversold territory, highlighting a potential buying opportunity. Additionally, the Chaikin Money Flow (CMF) indicator shows positive inflows, suggesting strong institutional interest. This mix of indicators underlines the potential for upward movement, making it an ideal stock to consider buying today.",
    "AAPL exhibits strong bullish potential based on its technical indicators. The price of this stock is approaching a significant resistance level that, if broken, could lead to a substantial upward move. The RSI is currently at a neutral level, leaving room for further gains. Additionally, the On-Balance Volume (OBV) indicator is rising, showing that volume supports the price movement. These factors, combined with its solid market position, make this stock a good buy today.",
    "The bullish outlook for AAPL is bolstered by its technical indicators, such as trading near a major trendline support, which has historically been a launching point for price increases. The RSI indicates oversold conditions, suggesting this stock is undervalued. Furthermore, the Stochastic Oscillator has crossed into the bullish zone, reinforcing the case for a rebound. These signals, along with continued innovation, make this stock a compelling buy today.",
    "AAPL stands out as a bullish trade because it is approaching a critical Fibonacci retracement level, which could act as strong support and trigger a reversal. The RSI is showing signs of a potential move from oversold conditions, while the MACD line has crossed above the signal line, indicating the start of an upward trend. With these indicators aligning, this stock appears to be a smart buy for today.",
    "AAPL is a bullish trade today, supported by its technical indicators showing it is testing a strong moving average support, which has historically led to price rebounds. The RSI is trending upwards from oversold conditions, and the Average Directional Index (ADX) indicates a strengthening bullish trend. Given these positive signals, combined with strong fundamentals, this stock looks like an ideal buy.",
    "The bullish case for AAPL is underscored by technical indicators that show it bouncing off a significant support level, which could lead to a rally. The RSI is beginning to rise, moving out of oversold territory, while the Bollinger Bands suggest that the price could expand upwards. Additionally, the MACD is showing a bullish crossover, signaling momentum is shifting to the upside. These indicators make this stock an attractive buy today.",
    "AAPL presents a bullish trading opportunity as it approaches a key support zone, which has previously acted as a springboard for upward moves. The RSI is pointing towards an oversold condition, and the Parabolic SAR (Stop and Reverse) has flipped to indicate a bullish trend. With these technical indicators signaling a potential uptrend, this stock stands out as a strong buy today.",
  ];

cron.schedule(CronExpression.MONDAY_TO_FRIDAY_AT_9AM, async () => {
  console.log("Monday to friday at 9am");
  let stock_data= {dayTrading: await getDayTradingStocks(7)}
    await storStockData(stock_types[0], stock_data)

});

cron.schedule(CronExpression.MONDAY_TO_FRIDAY_AT_4_30PM, async () => {
  console.log("Monday to friday  at 4:30 pm");
  let stock_data= {dayTrading: await getDayTradingStocks(7)}
  await storStockData(stock_types[1], stock_data)
});


cron.schedule(CronExpression.EVERY_7_MINUTES, async () => {

  console.log("EVERY_7_MINUTES");
  let trading_data={}

  if(trading_shift_counter===0){
    trading_data = {dayTrading: await getDayTradingStocks(30)}
  } else if( trading_shift_counter===1){
    trading_data = {swingTrading: await getSwingTradingStocks(30)}
  }else if( trading_shift_counter===2){
    trading_data = {longTerm: await getLongTermStocks(30)}
  }
    await storTradingData(trading_types[trading_shift_counter], trading_data)
    trading_shift_counter++;
    if(trading_shift_counter>2){
      trading_shift_counter=0;
    }

});


async function storTradingData(trading_type, trading_data){
  try {

    let trading_hostory = await pool.query(
      `SELECT * FROM trading_history WHERE trading_type = $1`,
      [trading_type]
    );

    if (trading_hostory.rows && trading_hostory.rows.length > 0) {
     let res= await pool.query(
          `UPDATE trading_history SET trading_data = $1 WHERE trading_type = $2`,
          [trading_data, trading_type]
        );
    } else {
      const result = await pool.query(
       `INSERT INTO trading_history (
         trading_data, trading_type
          ) VALUES ($1, $2);`,
        [trading_data, trading_type]
      );
          
    }



  } catch (error) {
    console.log(error);
  }
}




async function storStockData(stock_type, stock_data) {
    try {
        let day_index = new Date().getDay();
        let stock_day = days[day_index];
      
        let stock_hostory = await pool.query(
          `SELECT * FROM stock_history WHERE stock_type = $1 AND stock_day = $2`,
          [stock_type, stock_day]
        );
    
        if (stock_hostory.rows && stock_hostory.rows.length > 0) {
         let res= await pool.query(
              `UPDATE stock_history SET stock_data = $1 WHERE stock_type = $2 AND stock_day = $3`,
              [stock_data, stock_type, stock_day]
            );
        } else {
          const result = await pool.query(
           `INSERT INTO stock_history (
             stock_data, stock_type, stock_day
              ) VALUES ($1, $2, $3);`,
            [stock_data, stock_type, stock_day]
          );
              
        }
        
    } catch (error) {
        console.log(error);
        
    }
    
 
}



async function getDayTradingStocks(limit = 7) {
    try {
      const pennyTickers = await fetchPennyStockTickers();
      const stocksData = await Promise.all(
        pennyTickers.map(ticker => fetchStockData(ticker))
      );
  
      const filteredStocks = stocksData
        .filter(stock => stock && stock.price >= 0.001 && stock.volume >= 1000000)
        .sort((a, b) => b.change_percent - a.change_percent)
        .slice(0, limit)
        .map(stock => ({
          ...stock,
          analysis: generateAnalysis(stock.ticker)
        }));
  
      return filteredStocks;
    } catch (error) {
        console.error('Error in getDayTradingStocks:', error);
        return {error:error.message}
      
    }
  }




  async function getSwingTradingStocks(limit = 7) {
    try {
      const sp500Tickers = await fetchSP500Tickers();
      const stocksData = await Promise.all(
        sp500Tickers.map(ticker => fetchStockData(ticker))
      );
  
      const filteredStocks = stocksData
        .filter(stock => stock &&
          stock.price >= 0.001 &&
          stock['50_MA'] > stock['200_MA'] &&
          stock.price >= 10 &&
          stock.price <= 1000)
        .sort((a, b) => b.volume - a.volume)
        .slice(0, limit)
        .map(stock => ({
          ...stock,
          analysis: generateAnalysis(stock.ticker)
        }));
  
      return filteredStocks;
    } catch (error) {
      console.error('Error in getSwingTradingStocks:', error);
      throw error;
    }
  }
  
  async function getLongTermStocks(limit = 7) {
    try {
      const sp500Tickers = await fetchSP500Tickers();
      const stocksData = await Promise.all(
        sp500Tickers.map(ticker => fetchStockData(ticker))
      );
  
      const filteredStocks = stocksData
        .filter(stock => stock &&
          stock.price >= 0.001 &&
          stock.market_cap > 1000000000 &&
          stock.pe_ratio &&
          stock.pe_ratio < 20)
        .sort((a, b) => b.market_cap - a.market_cap)
        .slice(0, limit)
        .map(stock => ({
          ...stock,
          analysis: generateAnalysis(stock.ticker)
        }));
  
      return filteredStocks;
    } catch (error) {
      console.error('Error in getLongTermStocks:', error);
      throw error;
    }
  }
  

  function generateAnalysis(ticker) {
    const prompt = prompts[Math.floor(Math.random() * prompts.length)]
      .replace("AAPL", ticker);
    return prompt;
  }