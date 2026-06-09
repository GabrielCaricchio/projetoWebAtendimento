import { Injectable, signal, computed } from '@angular/core';
import { Ticket, TicketType, TicketStatus, Guiche, QueueState, DailyReportSummary } from '../models/queue.models';

@Injectable({
  providedIn: 'root'
})
export class QueueService {
  // Banco de dados em memória persistido no localStorage
  private allTickets = signal<Ticket[]>([]);

  // Filas de espera do dia atual
  readonly spQueue = signal<Ticket[]>([]);
  readonly seQueue = signal<Ticket[]>([]);
  readonly sgQueue = signal<Ticket[]>([]);

  // Guichês
  readonly guiches = signal<Guiche[]>([
    { id: 1, status: 'idle' },
    { id: 2, status: 'idle' },
    { id: 3, status: 'idle' }
  ]);

  // Estado da simulação
  readonly state = signal<QueueState>({
    simulatedTime: 420, // 07:00 em minutos (7 * 60)
    simulatedDate: this.getTodayDateStr(),
    isPlaying: false,
    speed: 1,
    lastCalledType: null
  });

  // Últimas 5 senhas chamadas no painel
  readonly lastCalledTickets = signal<Ticket[]>([]);

  // Contadores de sequência diária por tipo (reiniciados diariamente)
  private sequenceCounters = {
    SP: 0,
    SE: 0,
    SG: 0
  };

  private intervalId: any = null;

  constructor() {
    this.loadFromLocalStorage();
    this.resetDayState();
  }

  // --- Inicialização ---

  private getTodayDateStr(): string {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private loadFromLocalStorage() {
    try {
      const ticketsStr = localStorage.getItem('smart_guiche_tickets');
      if (ticketsStr) {
        this.allTickets.set(JSON.parse(ticketsStr));
      }
    } catch (e) {
      console.error('Erro ao ler do localStorage', e);
    }
  }

  private saveToLocalStorage() {
    try {
      localStorage.setItem('smart_guiche_tickets', JSON.stringify(this.allTickets()));
    } catch (e) {
      console.error('Erro ao salvar no localStorage', e);
    }
  }

  // Reseta o estado diário (filas, guichês, contadores)
  resetDayState() {
    const currentDate = this.state().simulatedDate;
    
    // Filtra tickets pendentes do mesmo dia no banco de dados e limpa
    // Na verdade, apenas inicializa as filas a partir do que estiver como 'waiting' no banco de dados para a data atual
    const todayTickets = this.allTickets().filter(t => t.dateStr === currentDate);
    
    // Reconstrói contadores de sequência para o dia
    this.sequenceCounters.SP = Math.max(0, ...todayTickets.filter(t => t.type === 'SP').map(t => t.sequence));
    this.sequenceCounters.SE = Math.max(0, ...todayTickets.filter(t => t.type === 'SE').map(t => t.sequence));
    this.sequenceCounters.SG = Math.max(0, ...todayTickets.filter(t => t.type === 'SG').map(t => t.sequence));

    // Reconstrói as filas de espera
    this.spQueue.set(todayTickets.filter(t => t.status === 'waiting' && t.type === 'SP'));
    this.seQueue.set(todayTickets.filter(t => t.status === 'waiting' && t.type === 'SE'));
    this.sgQueue.set(todayTickets.filter(t => t.status === 'waiting' && t.type === 'SG'));

    // Reseta os guichês
    this.guiches.set([
      { id: 1, status: 'idle' },
      { id: 2, status: 'idle' },
      { id: 3, status: 'idle' }
    ]);

    // Reseta o painel de chamadas com as últimas 5 chamadas desse dia
    const calledToday = todayTickets
      .filter(t => t.status === 'called' || t.status === 'completed' || t.status === 'noshow')
      .sort((a, b) => (b.calledTime ?? 0) - (a.calledTime ?? 0))
      .slice(0, 5);
    this.lastCalledTickets.set(calledToday);

    // Determina o último chamado
    if (calledToday.length > 0) {
      this.state.update(s => ({ ...s, lastCalledType: calledToday[0].type }));
    } else {
      this.state.update(s => ({ ...s, lastCalledType: null }));
    }
  }

  // Reseta o horário de hoje para as 07:00, pausa simulações e limpa dados do dia atual
  resetClockAndDay() {
    this.pauseSimulation();

    // Reseta o horário simulado
    this.state.update(s => ({
      ...s,
      simulatedTime: 420,
      lastCalledType: null
    }));

    // Remove do banco de dados geral qualquer ticket gerado no dia atual
    const currentDate = this.state().simulatedDate;
    this.allTickets.update(list => list.filter(t => t.dateStr !== currentDate));
    this.saveToLocalStorage();

    // Zera contadores
    this.sequenceCounters.SP = 0;
    this.sequenceCounters.SE = 0;
    this.sequenceCounters.SG = 0;

    // Limpa filas de hoje
    this.spQueue.set([]);
    this.seQueue.set([]);
    this.sgQueue.set([]);

    // Reseta guichês
    this.guiches.set([
      { id: 1, status: 'idle' },
      { id: 2, status: 'idle' },
      { id: 3, status: 'idle' }
    ]);

    // Limpa painel de chamadas
    this.lastCalledTickets.set([]);
  }

  // --- Operações de Fila (Totem / AC) ---

  issueTicket(type: TicketType): Ticket {
    const now = this.state().simulatedTime;
    if (now < 420 || now >= 1020) {
      throw new Error('Fora do horário de expediente (07:00 - 17:00).');
    }

    const dateStr = this.state().simulatedDate;
    
    // Incrementar a sequência correspondente
    this.sequenceCounters[type]++;
    const seq = this.sequenceCounters[type];

    // Formatar número da senha: YYMMDD-PPSQ
    const parts = dateStr.split('-');
    const yy = parts[0].slice(-2);
    const mm = parts[1];
    const dd = parts[2];
    const sqStr = String(seq).padStart(2, '0');
    const ticketNumber = `${yy}${mm}${dd}-${type}${sqStr}`;

    const newTicket: Ticket = {
      number: ticketNumber,
      type: type,
      sequence: seq,
      status: 'waiting',
      issuedTime: now,
      dateStr: dateStr
    };

    // Adicionar ao banco de dados geral
    this.allTickets.update(list => [...list, newTicket]);
    this.saveToLocalStorage();

    // Adicionar à respectiva fila
    if (type === 'SP') this.spQueue.update(q => [...q, newTicket]);
    else if (type === 'SE') this.seQueue.update(q => [...q, newTicket]);
    else if (type === 'SG') this.sgQueue.update(q => [...q, newTicket]);

    return newTicket;
  }

  // --- Operações de Atendimento (Guichê / AA) ---

  callNextTicket(guicheId: number): Ticket | null {
    const now = this.state().simulatedTime;
    if (now < 420 || now >= 1020) {
      return null;
    }

    // Achar o guichê correspondente
    const guichesList = this.guiches();
    const gIndex = guichesList.findIndex(g => g.id === guicheId);
    if (gIndex === -1 || guichesList[gIndex].status === 'offline') {
      return null;
    }

    // Se já estiver atendendo, primeiro deve finalizar o atendimento atual
    if (guichesList[gIndex].status === 'serving') {
      this.completeService(guicheId);
    }

    // Escolhe o próximo ticket de acordo com a regra de prioridades
    const ticket = this.pullNextTicketFromQueues();
    if (!ticket) {
      return null;
    }

    // 5% de chance de não-comparecimento (no-show)
    const isNoShow = Math.random() < 0.05;

    if (isNoShow) {
      ticket.status = 'noshow';
      ticket.calledTime = now;
      ticket.completedTime = now;
      ticket.guicheId = guicheId;
      ticket.serviceDuration = 0;

      // Atualiza no banco de dados geral
      this.updateTicketInDb(ticket);

      // O guichê permanece ocioso (idle) imediatamente
      this.guiches.update(list => {
        const copy = [...list];
        copy[gIndex] = { ...copy[gIndex], status: 'idle', currentTicket: undefined };
        return copy;
      });

      // Adiciona ao painel de chamadas
      this.addCalledTicketToPanel(ticket);
      this.saveToLocalStorage();
      return ticket;
    } else {
      // Calcula a duração do atendimento
      let duration = 0;
      if (ticket.type === 'SP') {
        // 15 min +- 5 min uniformemente
        duration = 10 + Math.random() * 10;
      } else if (ticket.type === 'SG') {
        // 5 min +- 3 min uniformemente
        duration = 2 + Math.random() * 6;
      } else if (ticket.type === 'SE') {
        // 95% chance de 1 min, 5% chance de 5 min
        duration = Math.random() < 0.95 ? 1 : 5;
      }

      // Arredonda para 1 casa decimal para visualização limpa
      duration = Math.round(duration * 10) / 10;

      ticket.status = 'called';
      ticket.calledTime = now;
      ticket.guicheId = guicheId;
      ticket.serviceDuration = duration;

      this.updateTicketInDb(ticket);

      // O guichê entra em modo de atendimento
      this.guiches.update(list => {
        const copy = [...list];
        copy[gIndex] = {
          ...copy[gIndex],
          status: 'serving',
          currentTicket: ticket,
          serviceEndTime: now + duration
        };
        return copy;
      });

      this.addCalledTicketToPanel(ticket);
      this.saveToLocalStorage();
      return ticket;
    }
  }

  // Finaliza o atendimento atual de um guichê
  completeService(guicheId: number) {
    const now = this.state().simulatedTime;
    const guichesList = this.guiches();
    const gIndex = guichesList.findIndex(g => g.id === guicheId);
    
    if (gIndex !== -1 && guichesList[gIndex].status === 'serving') {
      const ticket = guichesList[gIndex].currentTicket;
      if (ticket) {
        ticket.status = 'completed';
        ticket.completedTime = now;
        this.updateTicketInDb(ticket);
      }

      this.guiches.update(list => {
        const copy = [...list];
        copy[gIndex] = { ...copy[gIndex], status: 'idle', currentTicket: undefined, serviceEndTime: undefined };
        return copy;
      });

      this.saveToLocalStorage();
    }
  }

  // --- Algoritmo de Prioridades (Crucial) ---

  private pullNextTicketFromQueues(): Ticket | null {
    const lastCalled = this.state().lastCalledType;
    let preferredTarget: 'SP' | 'non-SP' = (lastCalled === 'SP') ? 'non-SP' : 'SP';
    
    let ticket: Ticket | null = null;

    if (preferredTarget === 'non-SP') {
      // Tenta SE primeiro, depois SG
      if (this.seQueue().length > 0) {
        ticket = this.popTicketFromQueue('SE');
      } else if (this.sgQueue().length > 0) {
        ticket = this.popTicketFromQueue('SG');
      } else if (this.spQueue().length > 0) {
        // Fallback para SP se não houver senhas normais
        ticket = this.popTicketFromQueue('SP');
      }
    } else {
      // Tenta SP
      if (this.spQueue().length > 0) {
        ticket = this.popTicketFromQueue('SP');
      } else {
        // Fallback: SE primeiro, depois SG
        if (this.seQueue().length > 0) {
          ticket = this.popTicketFromQueue('SE');
        } else if (this.sgQueue().length > 0) {
          ticket = this.popTicketFromQueue('SG');
        }
      }
    }

    if (ticket) {
      this.state.update(s => ({ ...s, lastCalledType: ticket!.type }));
    }

    return ticket;
  }

  private popTicketFromQueue(type: TicketType): Ticket {
    let ticket: Ticket;
    if (type === 'SP') {
      const q = [...this.spQueue()];
      ticket = q.shift()!;
      this.spQueue.set(q);
    } else if (type === 'SE') {
      const q = [...this.seQueue()];
      ticket = q.shift()!;
      this.seQueue.set(q);
    } else {
      const q = [...this.sgQueue()];
      ticket = q.shift()!;
      this.sgQueue.set(q);
    }
    return ticket;
  }

  private updateTicketInDb(updatedTicket: Ticket) {
    this.allTickets.update(list => 
      list.map(t => t.number === updatedTicket.number ? { ...updatedTicket } : t)
    );
  }

  private addCalledTicketToPanel(ticket: Ticket) {
    this.lastCalledTickets.update(list => {
      const filtered = list.filter(t => t.number !== ticket.number);
      return [ticket, ...filtered].slice(0, 5);
    });
  }

  // --- Relógios e Controles de Simulação ---

  startSimulation() {
    if (this.state().isPlaying) return;
    
    // Se o expediente já terminou, reseta para o dia seguinte ou reinicia o atual
    if (this.state().simulatedTime >= 1020) {
      this.state.update(s => ({ ...s, simulatedTime: 420 }));
      this.resetDayState();
    }

    this.state.update(s => ({ ...s, isPlaying: true }));
    this.runInterval();
  }

  pauseSimulation() {
    this.state.update(s => ({ ...s, isPlaying: false }));
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  setSpeed(speed: number) {
    this.state.update(s => ({ ...s, speed: speed }));
    if (this.state().isPlaying) {
      this.runInterval(); // Reinicia o timer com a nova velocidade
    }
  }

  setDate(dateStr: string) {
    this.state.update(s => ({ ...s, simulatedDate: dateStr, simulatedTime: 420 }));
    this.resetDayState();
  }

  private runInterval() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    // O tempo base de um minuto da simulação:
    // Se velocidade é 1x, 1 minuto simulado leva 1000ms (1 segundo).
    // Se velocidade é 60x, 1 minuto simulado leva 1000/60 ms.
    const intervalMs = Math.max(10, 1000 / this.state().speed);
    
    this.intervalId = setInterval(() => {
      this.advanceTime(1);
    }, intervalMs);
  }

  // Avança o relógio da simulação em minutos
  advanceTime(minutes: number) {
    const currentState = this.state();
    let newTime = currentState.simulatedTime + minutes;

    if (newTime >= 1020) { // 17:00h
      newTime = 1020;
      this.state.update(s => ({ ...s, simulatedTime: newTime, isPlaying: false }));
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
      this.endShift();
      return;
    }

    this.state.update(s => ({ ...s, simulatedTime: newTime }));

    // Verifica se algum guichê terminou o atendimento nesse minuto
    this.guiches.update(list => {
      return list.map(g => {
        if (g.status === 'serving' && g.serviceEndTime !== undefined && newTime >= g.serviceEndTime) {
          // Finaliza o atendimento
          const ticket = g.currentTicket;
          if (ticket) {
            ticket.status = 'completed';
            ticket.completedTime = g.serviceEndTime; // terminou exatamente no tempo previsto
            this.updateTicketInDb(ticket);
          }
          return { ...g, status: 'idle', currentTicket: undefined, serviceEndTime: undefined };
        }
        return g;
      });
    });

    this.saveToLocalStorage();
  }

  // Encerra o expediente às 17h, descartando todas as senhas esperando nas filas
  private endShift() {
    const discardAndMark = (queue: Ticket[]) => {
      queue.forEach(t => {
        t.status = 'expired';
        this.updateTicketInDb(t);
      });
    };

    discardAndMark(this.spQueue());
    discardAndMark(this.seQueue());
    discardAndMark(this.sgQueue());

    this.spQueue.set([]);
    this.seQueue.set([]);
    this.sgQueue.set([]);

    // Finaliza atendimentos que ainda estão em andamento nos guichês
    this.guiches.update(list => {
      return list.map(g => {
        if (g.status === 'serving') {
          const ticket = g.currentTicket;
          if (ticket) {
            ticket.status = 'completed';
            ticket.completedTime = 1020; // completa na hora do fechamento
            this.updateTicketInDb(ticket);
          }
          return { ...g, status: 'idle', currentTicket: undefined, serviceEndTime: undefined };
        }
        return g;
      });
    });

    this.saveToLocalStorage();
  }

  // --- Simulação Automatizada Rápida ---

  // Simula um dia inteiro em background de forma instantânea
  simulateFullDayInstant(dateStr: string) {
    // 1. Inicializa o estado para aquele dia
    const dateObj = new Date(dateStr + 'T12:00:00');
    // Ignora domingos na simulação mensal
    if (dateObj.getDay() === 0) return;

    this.state.update(s => ({
      ...s,
      simulatedDate: dateStr,
      simulatedTime: 420,
      isPlaying: false
    }));

    // Limpa filas locais para o dia
    this.spQueue.set([]);
    this.seQueue.set([]);
    this.sgQueue.set([]);
    
    // Zera contadores
    this.sequenceCounters.SP = 0;
    this.sequenceCounters.SE = 0;
    this.sequenceCounters.SG = 0;

    // Remove do banco de dados geral qualquer ticket anterior desse mesmo dia (para evitar duplicações)
    this.allTickets.update(list => list.filter(t => t.dateStr !== dateStr));

    const simGuiches: Guiche[] = [
      { id: 1, status: 'idle' },
      { id: 2, status: 'idle' },
      { id: 3, status: 'idle' }
    ];

    let lastCalledTypeSim: TicketType | null = null;
    const simCalledPanel: Ticket[] = [];

    // Loop minuto a minuto (das 07:00 às 17:00 = 420 a 1020)
    for (let t = 420; t < 1020; t++) {
      // A. Completar atendimentos nos guichês
      for (let g of simGuiches) {
        if (g.status === 'serving' && g.serviceEndTime !== undefined && t >= g.serviceEndTime) {
          const ticket = g.currentTicket!;
          ticket.status = 'completed';
          ticket.completedTime = g.serviceEndTime;
          this.updateTicketInDb(ticket);
          g.status = 'idle';
          g.currentTicket = undefined;
          g.serviceEndTime = undefined;
        }
      }

      // B. Chegada aleatória de novos clientes (AC)
      // Média de 0.20 tickets por minuto (~120 por dia)
      if (Math.random() < 0.22) {
        // Determina o tipo (35% SP, 25% SE, 40% SG)
        const rand = Math.random();
        let type: TicketType = 'SG';
        if (rand < 0.35) type = 'SP';
        else if (rand < 0.60) type = 'SE';

        this.sequenceCounters[type]++;
        const seq = this.sequenceCounters[type];

        const parts = dateStr.split('-');
        const yy = parts[0].slice(-2);
        const mm = parts[1];
        const dd = parts[2];
        const sqStr = String(seq).padStart(2, '0');
        const ticketNumber = `${yy}${mm}${dd}-${type}${sqStr}`;

        const newTicket: Ticket = {
          number: ticketNumber,
          type: type,
          sequence: seq,
          status: 'waiting',
          issuedTime: t,
          dateStr: dateStr
        };

        // Adiciona ao banco geral
        this.allTickets.update(list => [...list, newTicket]);

        // Adiciona à fila de simulação
        if (type === 'SP') this.spQueue.update(q => [...q, newTicket]);
        else if (type === 'SE') this.seQueue.update(q => [...q, newTicket]);
        else if (type === 'SG') this.sgQueue.update(q => [...q, newTicket]);
      }

      // C. Tellers chamando próximos tickets (AA)
      for (let g of simGuiches) {
        if (g.status === 'idle') {
          // Tenta pegar da fila segundo prioridades
          let preferredTarget: 'SP' | 'non-SP' = (lastCalledTypeSim === 'SP') ? 'non-SP' : 'SP';
          let ticket: Ticket | null = null;

          if (preferredTarget === 'non-SP') {
            if (this.seQueue().length > 0) ticket = this.popTicketFromQueue('SE');
            else if (this.sgQueue().length > 0) ticket = this.popTicketFromQueue('SG');
            else if (this.spQueue().length > 0) ticket = this.popTicketFromQueue('SP');
          } else {
            if (this.spQueue().length > 0) ticket = this.popTicketFromQueue('SP');
            else {
              if (this.seQueue().length > 0) ticket = this.popTicketFromQueue('SE');
              else if (this.sgQueue().length > 0) ticket = this.popTicketFromQueue('SG');
            }
          }

          if (ticket) {
            lastCalledTypeSim = ticket.type;
            
            // 5% de chance de no-show
            const isNoShow = Math.random() < 0.05;

            if (isNoShow) {
              ticket.status = 'noshow';
              ticket.calledTime = t;
              ticket.completedTime = t;
              ticket.guicheId = g.id;
              ticket.serviceDuration = 0;
              this.updateTicketInDb(ticket);
              
              // Guichê permanece idle
              g.status = 'idle';
            } else {
              let duration = 0;
              if (ticket.type === 'SP') {
                duration = 10 + Math.random() * 10;
              } else if (ticket.type === 'SG') {
                duration = 2 + Math.random() * 6;
              } else if (ticket.type === 'SE') {
                duration = Math.random() < 0.95 ? 1 : 5;
              }

              duration = Math.round(duration * 10) / 10;

              ticket.status = 'called';
              ticket.calledTime = t;
              ticket.guicheId = g.id;
              ticket.serviceDuration = duration;
              this.updateTicketInDb(ticket);

              g.status = 'serving';
              g.currentTicket = ticket;
              g.serviceEndTime = t + duration;
            }

            // Adiciona ao painel simulado
            const filtered = simCalledPanel.filter(x => x.number !== ticket!.number);
            simCalledPanel.unshift(ticket);
            if (simCalledPanel.length > 5) simCalledPanel.pop();
          }
        }
      }
    }

    // D. Encerra o dia (17:00h - minuto 1020)
    // Marca quem sobrou como expirado
    const expireRemaining = (queue: Ticket[]) => {
      queue.forEach(t => {
        t.status = 'expired';
        this.updateTicketInDb(t);
      });
    };
    expireRemaining(this.spQueue());
    expireRemaining(this.seQueue());
    expireRemaining(this.sgQueue());

    this.spQueue.set([]);
    this.seQueue.set([]);
    this.sgQueue.set([]);

    // Salva no localStorage final
    this.saveToLocalStorage();

    // Sincroniza o estado atual do serviço com os dados gerados
    this.resetDayState();
    this.state.update(s => ({ ...s, simulatedTime: 1020 }));
  }

  // Simula um mês inteiro (e.g. "2026-06")
  simulateFullMonthInstant(yearMonth: string) {
    const parts = yearMonth.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);

    // Determina o número de dias no mês
    const daysInMonth = new Date(year, month, 0).getDate();

    // Limpa qualquer dado desse mês para evitar duplicações
    const prefix = `${String(year).slice(-2)}${String(month).padStart(2, '0')}`;
    this.allTickets.update(list => list.filter(t => !t.number.startsWith(prefix)));

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      this.simulateFullDayInstant(dateStr);
    }
  }

  // Limpa todo o histórico de dados
  clearAllHistory() {
    this.allTickets.set([]);
    this.saveToLocalStorage();
    this.resetDayState();
  }

  // --- Relatórios e Estatísticas ---

  // Obtém o relatório de um dia específico
  getDailyReport(dateStr: string): DailyReportSummary {
    const dayTickets = this.allTickets().filter(t => t.dateStr === dateStr);
    return this.buildSummary(dateStr, dayTickets);
  }

  // Obtém o relatório de um mês específico (formato YYYY-MM)
  getMonthlyReport(yearMonth: string): DailyReportSummary {
    const monthTickets = this.allTickets().filter(t => t.dateStr.startsWith(yearMonth));
    return this.buildSummary(yearMonth, monthTickets);
  }

  // Retorna todos os tickets do banco filtrados para visualização do relatório
  getTicketsForReport(filter: { dateStr?: string; monthStr?: string; type?: TicketType | 'ALL'; status?: TicketStatus | 'ALL' }): Ticket[] {
    let list = this.allTickets();

    if (filter.dateStr) {
      list = list.filter(t => t.dateStr === filter.dateStr);
    } else if (filter.monthStr) {
      list = list.filter(t => t.dateStr.startsWith(filter.monthStr!));
    }

    if (filter.type && filter.type !== 'ALL') {
      list = list.filter(t => t.type === filter.type);
    }

    if (filter.status && filter.status !== 'ALL') {
      list = list.filter(t => t.status === filter.status);
    }

    // Ordena por data/hora de emissão decrescente
    return [...list].sort((a, b) => b.issuedTime - a.issuedTime);
  }

  private buildSummary(label: string, tickets: Ticket[]): DailyReportSummary {
    const totalIssued = tickets.length;
    const served = tickets.filter(t => t.status === 'completed');
    const totalServed = served.length;
    const totalNoShow = tickets.filter(t => t.status === 'noshow').length;
    const totalExpired = tickets.filter(t => t.status === 'expired').length;

    const spTickets = tickets.filter(t => t.type === 'SP');
    const seTickets = tickets.filter(t => t.type === 'SE');
    const sgTickets = tickets.filter(t => t.type === 'SG');

    const spServed = spTickets.filter(t => t.status === 'completed');
    const seServed = seTickets.filter(t => t.status === 'completed');
    const sgServed = sgTickets.filter(t => t.status === 'completed');

    // Calcula tempos médios
    const avgDuration = (list: Ticket[]) => {
      if (list.length === 0) return 0;
      const sum = list.reduce((acc, t) => acc + (t.serviceDuration ?? 0), 0);
      return Math.round((sum / list.length) * 10) / 10;
    };

    return {
      dateStr: label,
      totalIssued,
      totalServed,
      totalNoShow,
      totalExpired,
      spIssued: spTickets.length,
      spServed: spServed.length,
      seIssued: seTickets.length,
      seServed: seServed.length,
      sgIssued: sgTickets.length,
      sgServed: sgServed.length,
      avgSpDuration: avgDuration(spServed),
      avgSeDuration: avgDuration(seServed),
      avgSgDuration: avgDuration(sgServed),
      avgOverallDuration: avgDuration(served)
    };
  }
}
