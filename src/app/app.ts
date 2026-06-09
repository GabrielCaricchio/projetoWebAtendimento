import { Component, inject, signal, computed, effect } from '@angular/core';
import { QueueService } from './services/queue.service';
import { Ticket, TicketType, TicketStatus } from './models/queue.models';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
  standalone: false
})
export class App {
  readonly queueService = inject(QueueService);
  protected readonly Math = Math;

  // Controle de Telas (4 Telas)
  readonly activeScreen = signal<'totem' | 'panel' | 'teller' | 'reports'>('totem');
  readonly reportViewType = signal<'daily' | 'monthly'>('daily');

  printPDF() {
    window.print();
  }

  // Filtros de Relatório
  readonly filterDate = signal<string>(this.getTodayDateStr());
  readonly filterMonth = signal<string>(this.getTodayMonthStr());
  readonly tableTypeFilter = signal<TicketType | 'ALL'>('ALL');
  readonly tableStatusFilter = signal<TicketStatus | 'ALL'>('ALL');

  // Estado local para interações visuais
  readonly lastPrintedTicket = signal<Ticket | null>(null);
  readonly flashActive = signal<boolean>(false);
  readonly soundEnabled = signal<boolean>(true);
  readonly simulating = signal<boolean>(false);
  readonly tvFullscreen = signal<boolean>(false);
  readonly confirmClear = signal<boolean>(false);
  private clearConfirmTimeout: any = null;

  // Opções de velocidades da simulação
  readonly speedOptions = [1, 10, 60, 300, 1800];

  constructor() {
    // Escuta quando uma senha nova for chamada para tocar som e piscar o painel
    effect(() => {
      const lastCalledList = this.queueService.lastCalledTickets();
      if (lastCalledList.length > 0) {
        const newest = lastCalledList[0];
        // Executa apenas se o ticket foi chamado recentemente no minuto atual
        if (newest.status === 'called') {
          this.triggerCallAlert(newest);
        }
      }
    });
  }

  // --- Helpers de Data e Hora ---

  private getTodayDateStr(): string {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private getTodayMonthStr(): string {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}`;
  }

  formatSimulatedTime(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = Math.floor(totalMinutes % 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  getShiftPercentage(totalMinutes: number): number {
    // 07:00 = 420, 17:00 = 1020. Total: 600 minutos
    const pct = ((totalMinutes - 420) / 600) * 100;
    return Math.max(0, Math.min(100, pct));
  }

  // --- Controles de Totem (AC) ---

  printTicket(type: TicketType) {
    try {
      const ticket = this.queueService.issueTicket(type);
      this.lastPrintedTicket.set(ticket);
      
      // Toca um bipe curto de impressão
      this.playPrintChime();

      // Esconde o ticket impresso do totem após 4 segundos
      setTimeout(() => {
        if (this.lastPrintedTicket()?.number === ticket.number) {
          this.lastPrintedTicket.set(null);
        }
      }, 4000);
    } catch (e: any) {
      alert(e.message || 'Erro ao emitir senha.');
    }
  }

  // --- Controles de Atendimento (AA) ---

  callTicket(guicheId: number) {
    this.queueService.callNextTicket(guicheId);
  }

  completeService(guicheId: number) {
    this.queueService.completeService(guicheId);
  }

  resetCurrentDay() {
    this.queueService.resetClockAndDay();
    this.lastPrintedTicket.set(null);
  }

  // --- Efeitos de Chamada (Som & Luzes) ---

  private triggerCallAlert(ticket: Ticket) {
    // Pisca o painel
    this.flashActive.set(true);
    setTimeout(() => this.flashActive.set(false), 2000);

    if (this.soundEnabled()) {
      this.playCallAudio(ticket);
    }
  }

  playPrintChime() {
    if (!this.soundEnabled()) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      
      // Simula barulho mecânico de impressora térmica
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.15);
      
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {
      console.warn('Web Audio API não suportada ou bloqueada:', e);
    }
  }

  playCallAudio(ticket: Ticket) {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      
      // Clinica Chime: Duas notas harmônicas (C5 -> E5)
      const now = ctx.currentTime;
      
      const playNote = (freq: number, start: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.12, start + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + duration);
      };
      
      // Toca chime
      playNote(523.25, now, 0.4); // C5
      playNote(659.25, now + 0.15, 0.6); // E5

      // Fala a senha sintetizada em português após o chime acabar
      setTimeout(() => {
        if (!this.soundEnabled()) return;
        
        // Decodifica tipo: SP -> Prioritária, SE -> Exame, SG -> Geral
        let typeSpelled = 'Geral';
        if (ticket.type === 'SP') typeSpelled = 'Prioritária';
        else if (ticket.type === 'SE') typeSpelled = 'Exame';

        // Separa número em dígitos individuais
        const seqSpelled = String(ticket.sequence).split('').join(' ');
        
        const announceText = `Senha ${typeSpelled} número ${seqSpelled}, no Guichê ${ticket.guicheId}`;
        
        const utterance = new SpeechSynthesisUtterance(announceText);
        utterance.lang = 'pt-BR';
        utterance.rate = 0.95; // Levemente mais lento para clareza
        utterance.volume = 0.8;
        
        // Encontra uma voz em português se disponível
        const voices = window.speechSynthesis.getVoices();
        const ptVoice = voices.find(v => v.lang.startsWith('pt'));
        if (ptVoice) {
          utterance.voice = ptVoice;
        }

        window.speechSynthesis.speak(utterance);
      }, 800);

    } catch (e) {
      console.warn('Erro ao reproduzir áudio:', e);
    }
  }

  // --- Operações de Relatórios & Simulação Automatizada ---

  // Retorna os dados resumidos do relatório
  readonly reportSummary = computed(() => {
    if (this.reportViewType() === 'daily') {
      return this.queueService.getDailyReport(this.filterDate());
    } else {
      return this.queueService.getMonthlyReport(this.filterMonth());
    }
  });

  // Retorna a lista de tickets detalhada para a tabela do relatório
  readonly reportTickets = computed(() => {
    const viewType = this.reportViewType();
    const filter = {
      dateStr: viewType === 'daily' ? this.filterDate() : undefined,
      monthStr: viewType === 'monthly' ? this.filterMonth() : undefined,
      type: this.tableTypeFilter(),
      status: this.tableStatusFilter()
    };
    return this.queueService.getTicketsForReport(filter);
  });

  // Gatilho de simulação de dia completo instantâneo
  async runFullDaySimulation() {
    this.simulating.set(true);
    // Dá um tempo para a UI renderizar o spinner
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      this.queueService.simulateFullDayInstant(this.filterDate());
    } finally {
      this.simulating.set(false);
    }
  }

  // Gatilho de simulação de mês completo instantâneo
  async runFullMonthSimulation() {
    this.simulating.set(true);
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      this.queueService.simulateFullMonthInstant(this.filterMonth());
    } finally {
      this.simulating.set(false);
    }
  }

  // Zera todo o banco de dados local com confirmação de dois passos
  clearAllHistory() {
    if (!this.confirmClear()) {
      this.confirmClear.set(true);
      if (this.clearConfirmTimeout) {
        clearTimeout(this.clearConfirmTimeout);
      }
      this.clearConfirmTimeout = setTimeout(() => {
        this.confirmClear.set(false);
      }, 4000);
    } else {
      if (this.clearConfirmTimeout) {
        clearTimeout(this.clearConfirmTimeout);
        this.clearConfirmTimeout = null;
      }
      this.queueService.clearAllHistory();
      this.confirmClear.set(false);
    }
  }

  // Exportar dados como JSON
  exportJSON() {
    const tickets = this.reportTickets();
    const summary = this.reportSummary();
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify({ summary, tickets }, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `relatorio_${summary.dateStr}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  // Exportar dados como CSV
  exportCSV() {
    const tickets = this.reportTickets();
    const summary = this.reportSummary();
    
    let csvContent = 'data:text/csv;charset=utf-8,\uFEFF'; // Adiciona BOM para UTF-8 (corrige acentos no Excel)
    
    // Cabeçalho do Resumo
    csvContent += `Relatorio;${summary.dateStr}\n`;
    csvContent += `Total Emitidas;${summary.totalIssued}\n`;
    csvContent += `Total Atendidas;${summary.totalServed}\n`;
    csvContent += `Total Ausencias;${summary.totalNoShow}\n`;
    csvContent += `Total Expiradas;${summary.totalExpired}\n\n`;

    // Cabeçalho dos Tickets
    csvContent += 'Senha;Tipo;Emissao;Atendimento;Guiche;Duração (min);Status\n';
    
    // Linhas de Tickets
    tickets.forEach(t => {
      const issued = this.formatSimulatedTime(t.issuedTime);
      const called = t.calledTime !== undefined ? this.formatSimulatedTime(t.calledTime) : '';
      const guiche = t.guicheId !== undefined ? `Guiche ${t.guicheId}` : '';
      const duration = t.serviceDuration !== undefined ? t.serviceDuration : '';
      
      let statusStr = 'Aguardando';
      if (t.status === 'completed') statusStr = 'Atendido';
      else if (t.status === 'noshow') statusStr = 'Ausente';
      else if (t.status === 'expired') statusStr = 'Expirado';
      else if (t.status === 'called') statusStr = 'Chamado';

      csvContent += `${t.number};${t.type};${issued};${called};${guiche};${duration};${statusStr}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', encodedUri);
    downloadAnchor.setAttribute('download', `relatorio_${summary.dateStr}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }
}
