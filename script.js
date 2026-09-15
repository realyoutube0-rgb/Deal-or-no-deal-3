// @ts-nocheck
/* ==========================================
   DEAL OR NO DEAL - DELUXE
   Core JavaScript Engine & Web Audio Sound
   ========================================== */

const BASE_RATIOS = [
  0.00000001, 0.000001, 0.000005, 0.00001, 0.000025, 0.00005, 0.000075,
  0.0001, 0.0002, 0.0003, 0.0004, 0.0005, 0.00075, 0.001, 0.0025,
  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.375, 0.5, 0.75, 1.0
];

const ROUND_TARGETS = [6, 5, 4, 3, 2, 1, 1, 1, 1];
const TRILLION = 1000000000000;

let appState = {
  balance: 0.00,
  debt: 0.00,
  peakBalance: 0.00,
  transactions: [],
  history: [],
  settings: { sound: true, music: true }
};

let gameSession = {
  active: false,
  cases: [],
  playerCase: null,
  roundIndex: 0,
  casesNeededThisRound: 6,
  casesOpenedThisRound: 0,
  currentOffer: 0,
  pendingRevealValue: null,
  entryFee: 0,
  caseValues: []
};

// --- AUDIO SYNTHESIZER ---
const AudioEngine = {
  ctx: null,
  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
  },
  playTone(freq, duration, type = 'sine') {
    if (!appState.settings.sound) return;
    this.init();
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) { }
  },
  click() { this.playTone(600, 0.05, 'square'); },
  openCase() { this.playTone(300, 0.2, 'sawtooth'); },
  revealLow() { this.playTone(800, 0.3, 'sine'); },
  revealHigh() {
    this.playTone(400, 0.2, 'triangle');
    setTimeout(() => this.playTone(200, 0.4, 'sawtooth'), 150);
  },
  banker() {
    this.playTone(523.25, 0.15, 'sine');
    setTimeout(() => this.playTone(659.25, 0.15, 'sine'), 150);
    setTimeout(() => this.playTone(783.99, 0.3, 'sine'), 300);
  },
  win() {
    [440, 554.37, 659.25, 880].forEach((freq, idx) => {
      setTimeout(() => this.playTone(freq, 0.4, 'triangle'), idx * 120);
    });
  }
};

// --- UTILITY FUNCTIONS ---
function formatMoney(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: amount < 1 && amount > 0 ? 2 : 0
  }).format(amount);
}

function saveData() {
  localStorage.setItem('dond_deluxe_save', JSON.stringify(appState));
}

function loadData() {
  const saved = localStorage.getItem('dond_deluxe_save');
  if (saved) {
    try {
      appState = Object.assign(appState, JSON.parse(saved));
    } catch (e) { console.error("Save load error", e); }
  }
  updateHeaderUI();
}

function recordTransaction(description, amount) {
  const tx = {
    desc: description,
    amount: amount,
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    runningBalance: appState.balance
  };
  appState.transactions.unshift(tx);
  if (appState.transactions.length > 50) appState.transactions.pop();
  saveData();
  renderBankView();
}

function getMaxDebtLimit() {
  return Math.max(2500, appState.peakBalance * 0.25);
}

function checkBankruptcy() {
  const netWorth = appState.balance - appState.debt;
  const maxDebt = getMaxDebtLimit();
  
  if (netWorth < -maxDebt) {
    showEndgameModal(
      "BANKRUPT",
      `Your debt (-${formatMoney(appState.debt)}) has exceeded your allowable limit (-${formatMoney(maxDebt)}). Financial progression reset required.`
    );
    return true;
  }
  return false;
}

function checkTrillionVictory() {
  if (appState.balance >= TRILLION) {
    AudioEngine.win();
    showEndgameModal(
      "YOU DID IT!",
      `╔════════════════════════════╗\n   $1,000,000,000,000\n   ONE TRILLION DOLLARS\n   GAME COMPLETE\n╚════════════════════════════╝`
    );
    return true;
  }
  return false;
}

function getCalculatedEntryFee() {
  if (appState.balance <= 0) return 0;
  const fee = Math.floor(appState.balance * 0.05);
  return Math.max(100, Math.min(fee, 5000000));
}

// --- DYNAMIC CASE VALUE SCALING ---
function calculateDynamicCases(maxJackpot) {
  const target = Math.max(100, maxJackpot);
  return BASE_RATIOS.map((ratio, index) => {
    if (index === 0) return 0.01;
    let val = target * ratio;
    return val >= 1 ? Math.round(val) : Math.round(val * 100) / 100;
  });
}

// --- ENTRY PAYMENT PROMPT ---
function promptEntryPayment() {
  const fee = getCalculatedEntryFee();
  document.getElementById('entry-fee-amount').innerText = fee === 0 ? "ENTRY: FREE" : `ENTRY: ${formatMoney(fee)}`;
  document.getElementById('entry-modal').classList.remove('hidden');
}

function handlePayAndStartGame() {
  const fee = getCalculatedEntryFee();
  const jackpotInput = parseFloat(document.getElementById('custom-jackpot-input').value) || 1000000;
  
  if (appState.balance < fee && appState.balance > 0) {
    AudioEngine.click();
    alert(`INSUFFICIENT FUNDS!\nYou need ${formatMoney(fee)} to play. Request an advance in the BANK page.`);
    document.getElementById('entry-modal').classList.add('hidden');
    switchTab('bank-view');
    return;
  }

  AudioEngine.click();

  if (fee > 0) {
    appState.balance -= fee;
    recordTransaction("GAME ENTRY FEE", -fee);
    updateHeaderUI();
  }

  document.getElementById('entry-modal').classList.add('hidden');
  initNewGameSession(fee, jackpotInput);
}

// --- GAME LOGIC ---
function initNewGameSession(fee, maxJackpot) {
  const generatedValues = calculateDynamicCases(maxJackpot);
  const shuffled = [...generatedValues].sort(() => Math.random() - 0.5);

  gameSession = {
    active: true,
    caseValues: generatedValues,
    cases: shuffled.map((val, idx) => ({ id: idx + 1, value: val, state: 'closed' })),
    playerCase: null,
    roundIndex: 0,
    casesNeededThisRound: ROUND_TARGETS[0],
    casesOpenedThisRound: 0,
    currentOffer: 0,
    pendingRevealValue: null,
    entryFee: fee
  };

  document.getElementById('banker-banner').classList.add('hidden');
  renderGameView();
  updateStatus("CHOOSE YOUR CASE", "Select your lucky briefcase to keep until the end.");
}

function selectPlayerCase(briefcaseId) {
  const c = gameSession.cases.find(item => item.id === briefcaseId);
  if (!c || c.state !== 'closed') return;

  c.state = 'player';
  gameSession.playerCase = c;
  AudioEngine.click();

  renderGameView();
  startNextRoundTurn();
}

function startNextRoundTurn() {
  const needed = gameSession.casesNeededThisRound - gameSession.casesOpenedThisRound;
  
  if (needed > 0) {
    updateStatus(
      `ROUND ${gameSession.roundIndex + 1}`,
      `Open ${needed} briefcase${needed > 1 ? 's' : ''}`
    );
  } else {
    triggerBankerOffer();
  }
}

function openBriefcase(briefcaseId) {
  if (!gameSession.active || document.getElementById('banker-banner').classList.contains('hidden') === false) return;
  
  const c = gameSession.cases.find(item => item.id === briefcaseId);
  if (!c || c.state !== 'closed') return;

  c.state = 'opened';
  gameSession.casesOpenedThisRound++;
  gameSession.pendingRevealValue = c.value;
  
  AudioEngine.openCase();

  document.getElementById('reveal-case-num').innerText = `CASE ${c.id.toString().padStart(2, '0')}`;
  document.getElementById('reveal-amount').innerText = formatMoney(c.value);
  document.getElementById('reveal-modal').classList.remove('hidden');

  const maxVal = Math.max(...gameSession.caseValues);
  if (c.value >= maxVal * 0.1) {
    AudioEngine.revealHigh();
  } else {
    AudioEngine.revealLow();
  }
}

function handleContinueReveal() {
  AudioEngine.click();
  document.getElementById('reveal-modal').classList.add('hidden');
  renderGameView();

  const remainingClosed = gameSession.cases.filter(c => c.state === 'closed').length;
  
  if (remainingClosed === 1 && gameSession.playerCase) {
    triggerFinalTwoCasesStage();
  } else {
    startNextRoundTurn();
  }
}

function calculateBankerOffer() {
  const remainingValues = gameSession.cases
    .filter(c => c.state === 'closed' || c.state === 'player')
    .map(c => c.value);

  const count = remainingValues.length;
  const sum = remainingValues.reduce((a, b) => a + b, 0);
  const ev = sum / count;

  const progressRatio = (26 - count) / 24; 
  const offerPercentage = 0.20 + (progressRatio * 0.72);
  
  let offer = ev * offerPercentage;
  const variance = 1 + (Math.random() * 0.06 - 0.03);
  offer = Math.round(offer * variance);

  return Math.max(1, offer);
}

function triggerBankerOffer() {
  AudioEngine.banker();
  gameSession.currentOffer = calculateBankerOffer();
  
  document.getElementById('banker-offer-amount').innerText = formatMoney(gameSession.currentOffer);
  document.getElementById('banker-banner').classList.remove('hidden');
  updateStatus("BANKER'S OFFER", "Will you take the deal or risk opening more cases?");
}

function handleDeal() {
  AudioEngine.click();
  document.getElementById('banker-banner').classList.add('hidden');
  
  const winnings = gameSession.currentOffer;
  appState.balance += winnings;
  if (appState.balance > appState.peakBalance) appState.peakBalance = appState.balance;
  
  recordTransaction("DEAL ACCEPTED", winnings);
  recordHistoryLog("DEAL", winnings, gameSession.currentOffer);

  updateHeaderUI();
  
  if (!checkTrillionVictory()) {
    showEndgameModal("DEAL ACCEPTED!", `You walked away with ${formatMoney(winnings)}!`);
  }
  gameSession.active = false;
}

function handleNoDeal() {
  AudioEngine.click();
  document.getElementById('banker-banner').classList.add('hidden');

  gameSession.roundIndex++;
  gameSession.casesOpenedThisRound = 0;
  gameSession.casesNeededThisRound = ROUND_TARGETS[Math.min(gameSession.roundIndex, ROUND_TARGETS.length - 1)];

  startNextRoundTurn();
}

function triggerFinalTwoCasesStage() {
  const lastOtherCase = gameSession.cases.find(c => c.state === 'closed');
  updateStatus("FINAL CHOICE", `Your Case #${gameSession.playerCase.id} vs Case #${lastOtherCase.id}`);
  
  setTimeout(() => {
    const playerVal = gameSession.playerCase.value;
    appState.balance += playerVal;
    if (appState.balance > appState.peakBalance) appState.peakBalance = appState.balance;

    recordTransaction("FINAL CASE REVEAL", playerVal);
    recordHistoryLog("NO DEAL (FINAL)", playerVal, gameSession.currentOffer);
    
    updateHeaderUI();

    if (!checkTrillionVictory()) {
      showEndgameModal(
        "FINAL REVEAL",
        `Your case contained ${formatMoney(playerVal)}!`
      );
    }
    gameSession.active = false;
  }, 800);
}

function recordHistoryLog(decision, wonAmount, offer) {
  appState.history.unshift({
    gameNum: appState.history.length + 1,
    result: decision,
    winnings: wonAmount,
    bankerOffer: offer,
    date: new Date().toLocaleDateString()
  });
  saveData();
  renderHistoryView();
}

// --- RENDERING ---
function renderGameView() {
  const grid = document.getElementById('briefcase-grid');
  const leftCol = document.getElementById('board-left');
  const rightCol = document.getElementById('board-right');

  grid.innerHTML = '';
  leftCol.innerHTML = '';
  rightCol.innerHTML = '';

  // Render Briefcase Grid (Selected case completely hidden from view)
  gameSession.cases.forEach(c => {
    if (c.state === 'player') return; // Do not render chosen player case on screen

    const el = document.createElement('div');
    el.className = `briefcase ${c.state}`;
    el.innerHTML = `<div class="briefcase-plate">${c.id.toString().padStart(2, '0')}</div>`;
    
    el.addEventListener('click', () => {
      if (gameSession.playerCase === null) {
        selectPlayerCase(c.id);
      } else {
        openBriefcase(c.id);
      }
    });

    grid.appendChild(el);
  });

  // Render Money Board Columns
  const activeValues = gameSession.caseValues.length > 0 ? gameSession.caseValues : BASE_RATIOS.map(r => r * 1000000);
  const openedValues = gameSession.cases.filter(c => c.state === 'opened').map(c => c.value);

  activeValues.forEach((val, idx) => {
    const isEliminated = openedValues.includes(val);
    const cell = document.createElement('div');
    cell.className = `money-cell ${isEliminated ? 'eliminated' : ''}`;
    cell.innerText = formatMoney(val);

    if (idx < 13) {
      leftCol.appendChild(cell);
    } else {
      rightCol.appendChild(cell);
    }
  });
}

function renderBankView() {
  document.getElementById('bank-balance-total').innerText = formatMoney(appState.balance);
  document.getElementById('bank-debt-amount').innerText = `${formatMoney(appState.debt)} Owed`;
  
  const totalWon = appState.transactions.filter(t => t.amount > 0).reduce((a, b) => a + b.amount, 0);
  const totalSpent = appState.transactions.filter(t => t.amount < 0).reduce((a, b) => a + Math.abs(b.amount), 0);

  document.getElementById('bank-total-won').innerText = formatMoney(totalWon);
  document.getElementById('bank-total-spent').innerText = formatMoney(totalSpent);

  const txList = document.getElementById('transaction-list');
  txList.innerHTML = '';

  appState.transactions.forEach(t => {
    const item = document.createElement('div');
    item.className = `tx-item ${t.amount >= 0 ? 'positive' : 'negative'}`;
    item.innerHTML = `
      <div>
        <div class="tx-desc">${t.desc}</div>
        <div class="tx-date">${t.date}</div>
      </div>
      <div class="tx-amount">${t.amount >= 0 ? '+' : ''}${formatMoney(t.amount)}</div>
    `;
    txList.appendChild(item);
  });
}

function renderHistoryView() {
  document.getElementById('hist-total-games').innerText = appState.history.length;
  const maxWin = appState.history.reduce((max, h) => Math.max(max, h.winnings), 0);
  document.getElementById('hist-best-deal').innerText = formatMoney(maxWin);

  const container = document.getElementById('history-list');
  container.innerHTML = '';

  appState.history.forEach(h => {
    const card = document.createElement('div');
    card.className = 'bank-card';
    card.style.marginBottom = '8px';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; font-weight:bold; color:var(--gold-bright);">
        <span>GAME #${h.gameNum} - ${h.result}</span>
        <span>${formatMoney(h.winnings)}</span>
      </div>
      <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">
        Offer: ${formatMoney(h.bankerOffer)} | Date: ${h.date}
      </div>
    `;
    container.appendChild(card);
  });
}

function updateHeaderUI() {
  document.getElementById('top-balance-display').innerText = formatMoney(appState.balance);
  const debtContainer = document.getElementById('top-debt-container');
  
  if (appState.debt > 0) {
    debtContainer.style.display = 'flex';
    document.getElementById('top-debt-display').innerText = `-${formatMoney(appState.debt)}`;
  } else {
    debtContainer.style.display = 'none';
  }
}

function updateStatus(title, subtitle) {
  document.getElementById('status-title').innerText = title;
  document.getElementById('status-subtitle').innerText = subtitle;
}

function showEndgameModal(title, message) {
  document.getElementById('endgame-title').innerText = title;
  document.getElementById('endgame-message').innerText = message;
  document.getElementById('endgame-modal').classList.remove('hidden');
}

// --- NAVIGATION & TABS ---
function switchTab(targetId) {
  AudioEngine.click();
  document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));

  document.getElementById(targetId).classList.add('active');
  document.querySelector(`[data-target="${targetId}"]`).classList.add('active');

  if (targetId === 'bank-view') renderBankView();
  if (targetId === 'history-view') renderHistoryView();
}

// --- EVENT LISTENERS & INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  loadData();

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.target));
  });

  document.getElementById('btn-deal').addEventListener('click', handleDeal);
  document.getElementById('btn-no-deal').addEventListener('click', handleNoDeal);
  document.getElementById('btn-continue-reveal').addEventListener('click', handleContinueReveal);
  
  document.getElementById('btn-pay-entry').addEventListener('click', handlePayAndStartGame);

  // Take Loan Advance
  document.getElementById('btn-take-credit').addEventListener('click', () => {
    AudioEngine.click();
    const maxDebt = getMaxDebtLimit();
    if (appState.debt + 10800 > maxDebt) {
      alert(`Advance denied. Borrowing $10,000 (+8% fee) would exceed your debt cap (-${formatMoney(maxDebt)}).`);
      return;
    }
    appState.balance += 10000;
    appState.debt += 10800;
    recordTransaction("BANK ADVANCE (+8% FEE)", 10000);
    updateHeaderUI();
    renderBankView();
  });

  // Pay Off Debt Button
  document.getElementById('btn-pay-debt').addEventListener('click', () => {
    AudioEngine.click();
    const amount = parseFloat(document.getElementById('pay-debt-input').value);
    
    if (appState.debt <= 0) return alert("You have no debt to pay!");
    if (!amount || amount <= 0) return alert("Please enter a valid payment amount.");
    if (amount > appState.balance) return alert("Insufficient bank balance to pay this amount!");

    const actualPay = Math.min(amount, appState.debt);
    appState.balance -= actualPay;
    appState.debt -= actualPay;
    
    recordTransaction("DEBT REPAYMENT", -actualPay);
    document.getElementById('pay-debt-input').value = '';
    updateHeaderUI();
    renderBankView();
  });

  document.getElementById('toggle-sound').addEventListener('click', (e) => {
    appState.settings.sound = !appState.settings.sound;
    e.target.classList.toggle('active');
    e.target.innerText = appState.settings.sound ? 'ON' : 'OFF';
    saveData();
  });

  document.getElementById('toggle-music').addEventListener('click', (e) => {
    appState.settings.music = !appState.settings.music;
    e.target.classList.toggle('active');
    e.target.innerText = appState.settings.music ? 'ON' : 'OFF';
    saveData();
  });

  document.getElementById('btn-reset-game').addEventListener('click', () => {
    if (confirm("ARE YOU SURE?\nThis will erase your entire financial history.")) {
      localStorage.removeItem('dond_deluxe_save');
      appState = { balance: 0.00, debt: 0.00, peakBalance: 0.00, transactions: [], history: [], settings: { sound: true, music: true } };
      updateHeaderUI();
      promptEntryPayment();
      switchTab('game-view');
    }
  });

  document.getElementById('btn-endgame-action').addEventListener('click', () => {
    document.getElementById('endgame-modal').classList.add('hidden');
    if (checkBankruptcy()) {
      appState = { balance: 0.00, debt: 0.00, peakBalance: 0.00, transactions: [], history: [], settings: appState.settings };
      saveData();
      updateHeaderUI();
    }
    promptEntryPayment();
  });

  promptEntryPayment();
});
