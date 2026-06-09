export type TicketType = 'SP' | 'SE' | 'SG';

export type TicketStatus = 'waiting' | 'called' | 'completed' | 'noshow' | 'expired';

export interface Ticket {
  number: string;        // Formato YYMMDD-PPSQ
  type: TicketType;
  sequence: number;
  status: TicketStatus;
  issuedTime: number;    // Minutos desde 00:00 do dia simulado
  calledTime?: number;   // Minutos desde 00:00
  completedTime?: number;// Minutos desde 00:00
  guicheId?: number;     // Número do guichê (1, 2, 3, etc.)
  serviceDuration?: number; // Duração do atendimento em minutos
  dateStr: string;       // Formato YYYY-MM-DD
}

export interface Guiche {
  id: number;
  status: 'idle' | 'serving' | 'offline';
  currentTicket?: Ticket;
  serviceEndTime?: number; // Minuto simulado em que o atendimento atual vai terminar
}

export interface QueueState {
  simulatedTime: number;   // Minutos desde 00:00 (e.g., 420 = 07:00)
  simulatedDate: string;   // 'YYYY-MM-DD'
  isPlaying: boolean;
  speed: number;           // Fator de aceleração (1x, 10x, 60x, etc.)
  lastCalledType: TicketType | null;
}

export interface DailyReportSummary {
  dateStr: string;
  totalIssued: number;
  totalServed: number;
  totalNoShow: number;
  totalExpired: number;
  
  // Por tipo de senha (emitido / atendido)
  spIssued: number;
  spServed: number;
  seIssued: number;
  seServed: number;
  sgIssued: number;
  sgServed: number;

  // Tempos médios (em minutos)
  avgSpDuration: number;
  avgSeDuration: number;
  avgSgDuration: number;
  avgOverallDuration: number;
}
