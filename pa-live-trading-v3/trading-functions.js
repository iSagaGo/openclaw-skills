/**
 * PA Live Trading V3 - 共享策略函数模块
 * 
 * 所有策略函数接收 config 参数，不依赖全局 CONFIG。
 * config 需包含: rapidMoveThreshold, historicalLookback, touchTolerance,
 *                bosLookback, minBreakAmount, requireCloseConfirm,
 *                riskWithBOS, riskWithoutBOS
 */

// ==================== 密集区识别（增强版） ====================

function findConsolidationZones(klines, lookback = 40, minKlines = 5) {
  const zones = [];
  
  for (let i = lookback; i < klines.length; i++) {
    const slice = klines.slice(i - lookback, i);
    
    for (let rangePercent = 0.01; rangePercent <= 0.05; rangePercent += 0.005) {
      const high = Math.max(...slice.map(k => k.high));
      const low = Math.min(...slice.map(k => k.low));
      const mid = (high + low) / 2;
      const targetRange = mid * rangePercent;
      
      let klinesInRange = 0;
      let rangeHigh = 0;
      let rangeLow = Infinity;
      
      for (const k of slice) {
        if (Math.abs(k.close - mid) < targetRange || Math.abs(k.open - mid) < targetRange) {
          klinesInRange++;
          rangeHigh = Math.max(rangeHigh, k.high);
          rangeLow = Math.min(rangeLow, k.low);
        }
      }
      
      if (klinesInRange >= minKlines) {
        const actualRange = (rangeHigh - rangeLow) / rangeLow;
        
        if (actualRange < 0.05) {
          zones.push({
            index: i,
            high: rangeHigh,
            low: rangeLow,
            mid: (rangeHigh + rangeLow) / 2,
            range: actualRange,
            klinesCount: klinesInRange,
            strength: klinesInRange
          });
          break;
        }
      }
    }
  }
  
  const merged = [];
  for (const zone of zones) {
    const existing = merged.find(z => 
      Math.abs(z.mid - zone.mid) / z.mid < 0.02 && 
      Math.abs(z.index - zone.index) < 20
    );
    
    if (!existing) {
      merged.push(zone);
    } else if (zone.klinesCount > existing.klinesCount) {
      merged[merged.indexOf(existing)] = zone;
    }
  }
  
  return merged;
}

function checkRapidMove(klines, zone, config) {
  const afterZone = klines.slice(zone.index, Math.min(zone.index + 10, klines.length));
  
  for (const k of afterZone) {
    const bodySize = Math.abs(k.close - k.open) / k.open;
    if (bodySize >= config.rapidMoveThreshold) {
      return true;
    }
  }
  
  return false;
}

function checkHistoricalLevel(klines, zone, zoneIndex, config) {
  const lookbackStart = Math.max(0, zoneIndex - config.historicalLookback);
  const historical = klines.slice(lookbackStart, zoneIndex);
  
  const isHistoricalLow = historical.filter(k => 
    Math.abs(k.low - zone.low) / zone.low < config.touchTolerance
  ).length >= 2;
  
  const isHistoricalHigh = historical.filter(k => 
    Math.abs(k.high - zone.high) / zone.high < config.touchTolerance
  ).length >= 2;
  
  return isHistoricalLow || isHistoricalHigh;
}

function countTouches(klines, zone, zoneIndex, config) {
  const lookbackStart = Math.max(0, zoneIndex - config.historicalLookback);
  const historical = klines.slice(lookbackStart, zoneIndex);
  
  let touches = 0;
  
  for (const k of historical) {
    if (k.low <= zone.high && k.high >= zone.low) {
      touches++;
    }
  }
  
  return touches;
}

function enhanceConsolidationZones(klines, zones, config) {
  const enhanced = [];
  
  for (const zone of zones) {
    let strength = zone.klinesCount;
    const features = [];
    
    const hasRapidMove = checkRapidMove(klines, zone, config);
    if (hasRapidMove) {
      strength += 5;
      features.push('供需区');
    }
    
    const isHistoricalLevel = checkHistoricalLevel(klines, zone, zone.index, config);
    if (isHistoricalLevel) {
      strength += 3;
      features.push('历史位置');
    }
    
    const touches = countTouches(klines, zone, zone.index, config);
    strength += touches;
    if (touches >= 3) {
      features.push(`${touches}次触及`);
    }
    
    enhanced.push({
      ...zone,
      strength: strength,
      features: features,
      originalStrength: zone.klinesCount
    });
  }
  
  return enhanced;
}

// ==================== BOS检测 ====================

function findPreviousHigh(klines, lookback = 20) {
  if (klines.length < lookback) return null;
  
  const recent = klines.slice(-lookback);
  let highestIndex = -1;
  let highestValue = -Infinity;
  
  for (let i = 3; i < recent.length - 3; i++) {
    const k = recent[i];
    
    const isLocalHigh = 
      k.high > recent[i-1].high &&
      k.high > recent[i-2].high &&
      k.high > recent[i-3].high &&
      k.high > recent[i+1].high &&
      k.high > recent[i+2].high &&
      k.high > recent[i+3].high;
    
    if (isLocalHigh && k.high > highestValue) {
      highestValue = k.high;
      highestIndex = i;
    }
  }
  
  if (highestIndex === -1) return null;
  
  return { price: highestValue, index: highestIndex };
}

function findPreviousLow(klines, lookback = 20) {
  if (klines.length < lookback) return null;
  
  const recent = klines.slice(-lookback);
  let lowestIndex = -1;
  let lowestValue = Infinity;
  
  for (let i = 3; i < recent.length - 3; i++) {
    const k = recent[i];
    
    const isLocalLow = 
      k.low < recent[i-1].low &&
      k.low < recent[i-2].low &&
      k.low < recent[i-3].low &&
      k.low < recent[i+1].low &&
      k.low < recent[i+2].low &&
      k.low < recent[i+3].low;
    
    if (isLocalLow && k.low < lowestValue) {
      lowestValue = k.low;
      lowestIndex = i;
    }
  }
  
  if (lowestIndex === -1) return null;
  
  return { price: lowestValue, index: lowestIndex };
}

function detectBOS(klines, trend, config) {
  const currentKline = klines[klines.length - 1];
  
  if (trend === 'up') {
    const prevHigh = findPreviousHigh(klines, config.bosLookback);
    
    if (prevHigh && currentKline.high > prevHigh.price) {
      const breakAmount = (currentKline.high - prevHigh.price) / prevHigh.price;
      
      if (config.requireCloseConfirm && currentKline.close <= prevHigh.price) {
        return { broken: false };
      }
      
      if (breakAmount < config.minBreakAmount) {
        return { broken: false };
      }
      
      return { type: 'bullish', broken: true };
    }
  } else if (trend === 'down') {
    const prevLow = findPreviousLow(klines, config.bosLookback);
    
    if (prevLow && currentKline.low < prevLow.price) {
      const breakAmount = (prevLow.price - currentKline.low) / prevLow.price;
      
      if (config.requireCloseConfirm && currentKline.close >= prevLow.price) {
        return { broken: false };
      }
      
      if (breakAmount < config.minBreakAmount) {
        return { broken: false };
      }
      
      return { type: 'bearish', broken: true };
    }
  }
  
  return { broken: false };
}

// ==================== 趋势判断 ====================

function getTrendAdvanced(klines, lookback = 40) {
  if (klines.length < lookback) return 'neutral';
  
  const recent = klines.slice(-lookback);
  let highs = [];
  let lows = [];
  
  for (let i = 3; i < recent.length - 3; i++) {
    if (recent[i].high > recent[i-1].high && 
        recent[i].high > recent[i-2].high &&
        recent[i].high > recent[i-3].high &&
        recent[i].high > recent[i+1].high && 
        recent[i].high > recent[i+2].high &&
        recent[i].high > recent[i+3].high) {
      highs.push({ index: i, value: recent[i].high });
    }
    if (recent[i].low < recent[i-1].low && 
        recent[i].low < recent[i-2].low &&
        recent[i].low < recent[i-3].low &&
        recent[i].low < recent[i+1].low && 
        recent[i].low < recent[i+2].low &&
        recent[i].low < recent[i+3].low) {
      lows.push({ index: i, value: recent[i].low });
    }
  }
  
  if (highs.length < 3 || lows.length < 3) return 'neutral';
  
  const recentLows = lows.slice(-3);
  const recentHighs = highs.slice(-3);
  
  if (recentLows.length >= 3 && recentHighs.length >= 3) {
    const lowsRising = recentLows[2].value > recentLows[1].value && 
                       recentLows[1].value > recentLows[0].value;
    const highsRising = recentHighs[2].value > recentHighs[1].value && 
                        recentHighs[1].value > recentHighs[0].value;
    
    if (lowsRising && highsRising) return 'up';
    
    const lowsFalling = recentLows[2].value < recentLows[1].value && 
                        recentLows[1].value < recentLows[0].value;
    const highsFalling = recentHighs[2].value < recentHighs[1].value && 
                         recentHighs[1].value < recentHighs[0].value;
    
    if (lowsFalling && highsFalling) return 'down';
  }
  
  return 'neutral';
}

// ==================== 支撑/阻力查找 ====================

function findSupportZone(klines, consolidationZones) {
  const currentPrice = klines[klines.length - 1].close;
  let bestZone = null;
  let bestScore = 0;
  
  for (const zone of consolidationZones) {
    if (currentPrice >= zone.low && currentPrice <= zone.high * 1.05) {
      const distance = Math.abs(currentPrice - zone.mid) / currentPrice;
      const score = 100 - distance * 1000 + zone.strength * 2;
      
      if (score > bestScore) {
        bestScore = score;
        bestZone = zone;
      }
    }
  }
  
  return bestZone;
}

function findResistanceZone(klines, consolidationZones) {
  const currentPrice = klines[klines.length - 1].close;
  let bestZone = null;
  let bestScore = 0;
  
  for (const zone of consolidationZones) {
    if (currentPrice <= zone.high && currentPrice >= zone.low * 0.95) {
      const distance = Math.abs(currentPrice - zone.mid) / currentPrice;
      const score = 100 - distance * 1000 + zone.strength * 2;
      
      if (score > bestScore) {
        bestScore = score;
        bestZone = zone;
      }
    }
  }
  
  return bestZone;
}

// ==================== 生成信号 ====================

/**
 * generateSignal - 生成交易信号
 * @param {Array} klines - K线数据
 * @param {string} interval - 'sol_1h' 或 'btc_1h' 等，sol_1h 时跳过 BOS
 * @param {object} config - 策略配置
 * @returns {object|null} 信号对象或 null
 */
function generateSignal(klines, interval, config) {
  if (klines.length < 100) return null;
  
  const currentKline = klines[klines.length - 1];
  const prevKline = klines[klines.length - 2];
  const currentPrice = currentKline.close;
  
  let consolidationZones = findConsolidationZones(klines);
  consolidationZones = enhanceConsolidationZones(klines, consolidationZones, config);
  
  const trend = getTrendAdvanced(klines);
  const supportZone = findSupportZone(klines, consolidationZones);
  const resistanceZone = findResistanceZone(klines, consolidationZones);
  
  // 做多信号
  if (trend === 'up' && supportZone) {
    const inZone = currentKline.low <= supportZone.high && currentKline.low >= supportZone.low;
    const bouncing = currentKline.close > prevKline.close;
    
    if (inZone && bouncing) {
      const slBuffer = config.slBuffer || 0.0015;
      const stopLoss = supportZone.low * (1 - slBuffer);
      const priceRisk = (currentPrice - stopLoss) / currentPrice;
      
      if (priceRisk > 0.01 && priceRisk < 0.10) {
        // SOL 不使用 BOS，固定 riskWithoutBOS；BTC 使用 BOS 动态风险
        let hasBOS = false;
        let riskPerTrade = config.riskWithoutBOS;
        if (interval !== 'sol_1h') {
          const bos = detectBOS(klines, 'up', config);
          hasBOS = bos.broken;
          riskPerTrade = hasBOS ? config.riskWithBOS : config.riskWithoutBOS;
        }
        
        const rrRatio = config.rrRatio || 1.6;
        return {
          direction: 'long',
          entry: currentPrice,
          stopLoss: stopLoss,
          priceRisk: priceRisk,
          riskPerTrade: riskPerTrade,
          takeProfit: currentPrice + (currentPrice * priceRisk * rrRatio),
          entryTime: currentKline.time || currentKline.openTime,
          hasBOS: hasBOS,
          interval: interval,
          zoneStrength: supportZone.strength,
          zoneFeatures: supportZone.features
        };
      }
    }
  }
  
  // 做空信号
  if (trend === 'down' && resistanceZone) {
    const inZone = currentKline.high >= resistanceZone.low && currentKline.high <= resistanceZone.high;
    const falling = currentKline.close < prevKline.close;
    
    if (inZone && falling) {
      const slBuffer = config.slBuffer || 0.0015;
      const stopLoss = resistanceZone.high * (1 + slBuffer);
      const priceRisk = (stopLoss - currentPrice) / currentPrice;
      
      if (priceRisk > 0.01 && priceRisk < 0.10) {
        // SOL 不使用 BOS，固定 riskWithoutBOS；BTC 使用 BOS 动态风险
        let hasBOS = false;
        let riskPerTrade = config.riskWithoutBOS;
        if (interval !== 'sol_1h') {
          const bos = detectBOS(klines, 'down', config);
          hasBOS = bos.broken;
          riskPerTrade = hasBOS ? config.riskWithBOS : config.riskWithoutBOS;
        }
        
        const rrRatio = config.rrRatio || 1.6;
        return {
          direction: 'short',
          entry: currentPrice,
          stopLoss: stopLoss,
          priceRisk: priceRisk,
          riskPerTrade: riskPerTrade,
          takeProfit: currentPrice - (currentPrice * priceRisk * rrRatio),
          entryTime: currentKline.time || currentKline.openTime,
          hasBOS: hasBOS,
          interval: interval,
          zoneStrength: resistanceZone.strength,
          zoneFeatures: resistanceZone.features
        };
      }
    }
  }
  
  return null;
}

// ==================== 导出 ====================

module.exports = {
  findConsolidationZones,
  enhanceConsolidationZones,
  checkRapidMove,
  checkHistoricalLevel,
  countTouches,
  detectBOS,
  findPreviousHigh,
  findPreviousLow,
  getTrendAdvanced,
  findSupportZone,
  findResistanceZone,
  generateSignal
};
