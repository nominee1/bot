import { api_base } from '@/external/bot-skeleton';

export type TTrade = {
  id: string;
  contractType: string;
  stake: number;
  market: string;
  duration: number;
  status: 'pending' | 'open' | 'active' | 'won' | 'lost' | 'error' | 'completed';
  timestamp: Date;
  closeTime?: Date;
  profit?: number;
  exitValue?: number;
  startTime?: string;
  barrier?: number;
  currentValue?: number;
  isBulkTrade?: boolean;
  bulkTradeId?: string;
};

type TStatus = { message: string; type: 'info' | 'success' | 'error' | 'loading' | 'warning' };
type TBulkQueueItem = {
  id: string;
  contractType: string;
  stake: number;
  market: string;
  duration: number;
  status: 'pending' | 'processing' | 'executed' | 'failed';
  attempts: number;
  maxAttempts: number;
};
type TBulkQueue = {
  active: boolean;
  processing: boolean;
  queue: TBulkQueueItem[];
  completed: number;
  failed: number;
  total: number;
};

export class TradingLogic {
  // State
  trades: TTrade[] = [];
  profitLoss = 0;
  tradeStatus: TStatus = { message: '', type: 'info' };
  isBulkTrading = false;
  bulkProgress = { completed: 0, failed: 0, total: 0 };
  isTurboMode = false;
  currentStrategy = 'even';
  contractTypes = { left: 'DIGITEVEN', right: 'DIGITODD' };
  payout = 0;
  profitValue = 0;

  // Refs (simulated with properties)
  tradeMarket = '1HZ10V';
  stakeAmount = 10;
  durationSelect = 1;
  predictionDigit = 1;
  bulkTradeCount = 1;
  tradeStrategy = 'even';

  // Internal state
  private subscribedContracts = new Set<string>();
  private statusCheckerInterval?: NodeJS.Timeout;
  private queueProcessorInterval?: NodeJS.Timeout;
  private bulkQueue: TBulkQueue | null = null;

  // Callbacks
  private updateUI: () => void;
  private playSound: (success: boolean) => void;

  constructor(updateUICallback: () => void, playSoundCallback: (success: boolean) => void) {
    this.updateUI = updateUICallback;
    this.playSound = playSoundCallback;
    this.init();
  }

  private init() {
    this.initEventListeners();
    this.setupStatusChecker();
    this.setupQueueProcessor();
    this.calculatePayout();
  }

  cleanup() {
    if (this.statusCheckerInterval) clearInterval(this.statusCheckerInterval);
    if (this.queueProcessorInterval) clearInterval(this.queueProcessorInterval);
    
    // Unsubscribe from all contracts
    this.trades.forEach(t => {
      if (['pending', 'open', 'active'].includes(t.status)) {
        this.unsubscribeFromContractUpdates(t.id);
      }
    });
  }

  private getContractsForStrategy(strategy: string): [string, string] {
    const map: Record<string, [string, string]> = {
      even: ['DIGITEVEN', 'DIGITODD'],
      odd: ['DIGITODD', 'DIGITEVEN'],
      matches: ['DIGITMATCH', 'DIGITDIFF'],
      differs: ['DIGITDIFF', 'DIGITMATCH'],
      over: ['DIGITOVER', 'DIGITUNDER'],
      under: ['DIGITUNDER', 'DIGITOVER'],
      rise: ['CALL', 'PUT'],
      fall: ['PUT', 'CALL'],
    };
    return map[strategy] || map.even;
  }

  private strategyNeedsDigit(strategy: string) {
    return ['matches', 'differs', 'over', 'under'].includes(strategy);
  }

  private initEventListeners() {
    // In a real implementation, this would attach to DOM events
  }

  private setupStatusChecker() {
    this.statusCheckerInterval = setInterval(() => {
      // Clean up subscriptions for completed trades
      this.trades
        .filter(t => ['open', 'active'].includes(t.status))
        .forEach(t => this.unsubscribeFromContractUpdates(t.id));
    }, 30000);
  }

  private setupQueueProcessor() {
    this.queueProcessorInterval = setInterval(() => {
      if (this.bulkQueue?.active && !this.bulkQueue.processing) {
        this.processBulkQueue();
      }
    }, 500);
  }

  private async subscribeToContractUpdates(id: string) {
    if (!api_base?.api || this.subscribedContracts.has(id)) return;
    
    try {
      await api_base.api.send({
        proposal_open_contract: 1,
        contract_id: id,
        subscribe: 1,
      });
      this.subscribedContracts.add(id);
    } catch (error) {
      console.error('Subscription error:', error);
    }
  }

  private async unsubscribeFromContractUpdates(id: string) {
    if (!this.subscribedContracts.has(id)) return;
    if (!/^\d+$/.test(id)) return; // Skip non-numeric IDs

    try {
      await api_base.api.send({
        proposal_open_contract: 0,
        contract_id: id,
      });
      this.subscribedContracts.delete(id);
    } catch (error) {
      console.error('Unsubscription error:', error);
    }
  }

  async placeTrade(
    contractType: string,
    isBulk = false,
    bulkId?: string,
    stakeOverride?: number,
    marketOverride?: string,
    durationOverride?: number
  ): Promise<string | null> {
    if (!api_base?.api) {
      this.showStatus('Not connected to API', 'error');
      if (!isBulk) return null;
      throw new Error('Not connected');
    }
  
    // Turbo mode validations
    if (this.isTurboMode && isBulk) {
      const pendingCount = this.bulkQueue?.queue.filter(t =>
        t.status === 'pending' || t.status === 'processing'
      ).length || 0;
  
      if (pendingCount > 5) {
        this.showStatus('Too many concurrent turbo trades', 'warning');
        throw new Error('Turbo limit exceeded');
      }
    }
  
    const stake = stakeOverride ?? this.stakeAmount;
    const duration = durationOverride ?? this.durationSelect;
    const market = marketOverride ?? this.tradeMarket;
  
    if (isNaN(stake)) {
      this.showStatus('Invalid stake amount', 'error');
      throw new Error('Invalid stake');
    }
  
    // For digit contracts
    let barrier: string | undefined;
    if (['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(contractType)) {
      const digit = this.predictionDigit;
      if (isNaN(digit)) {
        this.showStatus('Enter a prediction digit (0-9) first', 'error');
        throw new Error('Missing/invalid barrier');
      }
      barrier = digit.toString();
    }

    // Create optimistic trade entry
    const trade: TTrade = {
      id: Date.now().toString(),
      contractType,
      stake,
      market,
      duration,
      status: 'pending',
      timestamp: new Date(),
      startTime: new Date().toISOString(),
      isBulkTrade: isBulk,
      bulkTradeId: bulkId,
      ...(barrier ? { barrier: parseInt(barrier) } : {}),
    };

    this.trades = [trade, ...this.trades];
    this.showStatus(`Placing ${contractType.replace('DIGIT', '')}...`, 'loading');
    this.updateUI();

    try {
      const proposal = {
        buy: 1,
        price: stake,
        parameters: {
          amount: stake,
          basis: 'stake',
          contract_type: contractType,
          currency: 'USD',
          duration,
          duration_unit: 't',
          symbol: market,
          ...(barrier ? { barrier } : {}),
        },
      };

      const response = await api_base.api.send(proposal);

      if (response.error) {
        throw new Error(response.error.message);
      }

      // Update trade with real contract ID
      this.trades = this.trades.map(t =>
        t.id === trade.id ? { 
          ...t, 
          id: response.buy.contract_id, 
          status: 'open' 
        } : t
      );

      // Subscribe to updates
      this.subscribeToContractUpdates(response.buy.contract_id);

      this.showStatus('Trade placed successfully', 'success');
      this.updateUI();
      return response.buy.contract_id;
    } catch (error) {
      this.trades = this.trades.map(t =>
        t.id === trade.id ? { 
          ...t, 
          status: 'error',
          closeTime: new Date()
        } : t
      );
      this.showStatus(`Trade failed: ${error.message}`, 'error');
      this.updateUI();
      throw error;
    }
  }

  private markLastPendingAsError(errMsg: string) {
    const lastPendingIndex = this.trades.findIndex(t => t.status === 'pending');
    if (lastPendingIndex === -1) return;

    this.trades[lastPendingIndex] = {
      ...this.trades[lastPendingIndex],
      status: 'error',
      closeTime: new Date()
    };
    this.showStatus(errMsg, 'error');
    this.updateUI();
  }

  handleWebSocketMessage(data: any) {
    if (data.error) {
      if (data.echo_req?.buy === 1) {
        this.markLastPendingAsError(data.error.message || 'Trade failed');
      } else {
        this.showStatus(data.error.message, 'error');
      }
      return;
    }

    switch (data.msg_type) {
      case 'buy':
        this.showStatus('✅ Next', 'success');
        break;

      case 'proposal_open_contract':
        this.handleContractUpdate(data.proposal_open_contract);
        break;

      case 'transaction':
        if (data.transaction.action === 'sell') {
          this.handleTradeCompletion(data.transaction);
        }
        break;
    }
  }

  private handleContractUpdate(contract: any) {
    this.trades = this.trades.map(trade => {
      if (trade.id !== contract.contract_id) return trade;

      const profitNum = Number(contract.profit ?? 0);

      const updatedTrade: TTrade = {
        ...trade,
        profit: profitNum,
        exitValue: contract.exit_tick_value,
        currentValue: contract.current_spot
          ? Number(contract.current_spot)
          : undefined,
      };

      const isFinal =
        contract.is_sold ||
        contract.is_expired ||
        contract.is_settleable ||
        contract.status === 'sold';

      if (isFinal) {
        updatedTrade.status = profitNum > 0 ? 'won' : 'lost';
        updatedTrade.closeTime = new Date();
      } else {
        updatedTrade.status =
          contract.status === 'open'
            ? 'open'
            : contract.status === 'active'
            ? 'active'
            : trade.status;
      }

      return updatedTrade;
    });

    this.updateProfitLossSummary();
    this.updateUI();
  }

  private handleTradeCompletion(tx: any) {
    let updatedStatus: 'won' | 'lost' | null = null;

    this.trades = this.trades.map(trade => {
      if (trade.id !== tx.contract_id) return trade;

      const netProfit = Number(tx.amount) - trade.stake;
      updatedStatus = netProfit > 0 ? 'won' : 'lost';

      return {
        ...trade,
        status: updatedStatus,
        profit: netProfit,
        closeTime: new Date(tx.transaction_time * 1000),
      };
    });

    if (updatedStatus) {
      this.unsubscribeFromContractUpdates(tx.contract_id);
      this.playSound(updatedStatus === 'won');

      if (this.bulkQueue) {
        if (updatedStatus === 'won') this.bulkQueue.completed += 1;
        else this.bulkQueue.failed += 1;
        this.updateBulkProgress();
      }

      this.updateProfitLossSummary();
      this.updateUI();
    }
  }

  // Bulk trading
  startBulkTrade(contractType: string) {
    const count = this.bulkTradeCount;
    const stake = this.stakeAmount;
    const duration = this.durationSelect;
    const market = this.tradeMarket;

    if (isNaN(count) || count <= 0) {
      this.showStatus('Invalid trade count', 'error');
      return;
    }
    if (isNaN(stake) || stake <= 0) {
      this.showStatus('Invalid stake amount', 'error');
      return;
    }

    this.bulkQueue = {
      active: true,
      processing: false,
      queue: Array(count).fill(null).map((_, i) => ({
        id: `bulk-${Date.now()}-${i}`,
        contractType,
        stake,
        market,
        duration,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
      })),
      completed: 0,
      failed: 0,
      total: count,
    };

    this.isBulkTrading = true;
    this.bulkProgress = { completed: 0, failed: 0, total: count };
    this.showStatus(
      `Bulk trade started (${count} × ${contractType.replace('DIGIT', '')})`,
      'info'
    );
    this.processBulkQueue();
    this.updateUI();
  }

  private async processBulkQueue() {
    if (!this.bulkQueue || !this.bulkQueue.active || this.bulkQueue.processing) {
      return;
    }

    const nextTrade = this.bulkQueue.queue.find(t => t.status === 'pending');
    if (!nextTrade) {
      if (this.bulkQueue.completed + this.bulkQueue.failed === this.bulkQueue.total) {
        this.stopBulkTrade('Bulk trade completed');
      }
      return;
    }

    this.bulkQueue.processing = true;
    nextTrade.status = 'processing';
    nextTrade.attempts++;

    try {
      await this.placeTrade(
        nextTrade.contractType,
        true,
        nextTrade.id,
        nextTrade.stake,
        nextTrade.market,
        nextTrade.duration
      );
      nextTrade.status = 'executed';
      this.bulkQueue.completed++;
    } catch (error) {
      if (nextTrade.attempts >= nextTrade.maxAttempts) {
        nextTrade.status = 'failed';
        this.bulkQueue.failed++;
      } else {
        nextTrade.status = 'pending';
      }
    } finally {
      this.bulkQueue.processing = false;
      this.updateBulkProgress();
      setTimeout(() => this.processBulkQueue(), this.isTurboMode ? 100 : 500);
    }
  }

  stopBulkTrade(message: string) {
    if (this.bulkQueue) this.bulkQueue.active = false;
    this.isBulkTrading = false;
    this.showStatus(message, 'info');
    this.updateUI();
  }

  private updateBulkProgress() {
    if (!this.bulkQueue) return;
    this.bulkProgress = {
      completed: this.bulkQueue.completed,
      failed: this.bulkQueue.failed,
      total: this.bulkQueue.total
    };
    this.updateUI();
  }

  resetTrades() {
    // Unsubscribe from all contracts
    this.trades.forEach(t => {
      if (['pending', 'open', 'active'].includes(t.status)) {
        this.unsubscribeFromContractUpdates(t.id);
      }
    });

    // Clear all trades
    this.trades = [];
    this.profitLoss = 0;

    // Stop bulk trading if active
    if (this.bulkQueue?.active) {
      this.stopBulkTrade('Bulk trade cancelled');
    }
    this.bulkQueue = null;

    // Clear subscriptions
    this.subscribedContracts.clear();

    this.showStatus('History cleared', 'info');
    this.updateUI();
  }

  private showStatus(message: string, type: 'info' | 'success' | 'error' | 'loading' | 'warning') {
    this.tradeStatus = { message, type };
    this.updateUI();
  }

  calculatePayout() {
    const payoutValue = this.stakeAmount * 1.845;
    this.payout = payoutValue;
    this.profitValue = payoutValue - this.stakeAmount;
    this.updateUI();
  }

  private updateProfitLossSummary() {
    const total = this.trades.reduce((sum, trade) => {
      return trade.profit !== undefined ? sum + trade.profit : sum;
    }, 0);
    this.profitLoss = total;
    this.updateUI();
  }

  handleStrategyChange(strategy: string) {
    this.currentStrategy = strategy;
    const types = this.getContractsForStrategy(strategy);
    this.contractTypes = { left: types[0], right: types[1] };
    this.updateUI();
  }

  // Getters for UI
  getTrades() {
    return [...this.trades];
  }

  getTradeStatus() {
    return { ...this.tradeStatus };
  }

  getBulkProgress() {
    return { ...this.bulkProgress };
  }

  getContractTypes() {
    return { ...this.contractTypes };
  }

  getLabel(contract: string) {
    const map: Record<string, string> = {
      DIGITEVEN: 'Even',
      DIGITODD: 'Odd',
      DIGITMATCH: 'Matches',
      DIGITDIFF: 'Differs',
      DIGITOVER: 'Over',
      DIGITUNDER: 'Under',
      CALL: 'Rise',
      PUT: 'Fall',
    };
    return map[contract] || contract;
  }

  // Setters for UI inputs
  setTradeMarket(market: string) {
    this.tradeMarket = market;
  }

  setStakeAmount(amount: number) {
    this.stakeAmount = amount;
    this.calculatePayout();
  }

  setDurationSelect(duration: number) {
    this.durationSelect = duration;
  }

  setPredictionDigit(digit: number) {
    this.predictionDigit = digit;
  }

  setBulkTradeCount(count: number) {
    this.bulkTradeCount = count;
  }

  setTradeStrategy(strategy: string) {
    this.tradeStrategy = strategy;
    this.handleStrategyChange(strategy);
  }

  setTurboMode(enabled: boolean) {
    this.isTurboMode = enabled;
    this.updateUI();
  }
}