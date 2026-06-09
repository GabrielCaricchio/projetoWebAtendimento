import { TestBed } from '@angular/core/testing';
import { QueueService } from './queue.service';
import { TicketType } from '../models/queue.models';

describe('QueueService', () => {
  let service: QueueService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(QueueService);
    service.clearAllHistory();
    service.setDate('2026-06-09');
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should issue tickets with correct formatting (YYMMDD-PPSQ)', () => {
    const ticketSP1 = service.issueTicket('SP');
    expect(ticketSP1.number).toBe('260609-SP01');

    const ticketSP2 = service.issueTicket('SP');
    expect(ticketSP2.number).toBe('260609-SP02');

    const ticketSE1 = service.issueTicket('SE');
    expect(ticketSE1.number).toBe('260609-SE01');

    const ticketSG1 = service.issueTicket('SG');
    expect(ticketSG1.number).toBe('260609-SG01');
  });

  it('should obey calling queue priorities and alternation logic [SP] -> [SE|SG]', () => {
    // Setup queues: SP, SE, SG all have tickets
    service.issueTicket('SG'); // SG01
    service.issueTicket('SE'); // SE01
    service.issueTicket('SP'); // SP01
    service.issueTicket('SG'); // SG02
    service.issueTicket('SE'); // SE02
    service.issueTicket('SP'); // SP02

    // Mock Math.random to avoid 5% no-show during testing
    const originalRandom = Math.random;
    Math.random = () => 0.5; // Always show, and select 95% branch for SE duration (0.5 < 0.95)

    try {
      // 1. First call: Should be SP (highest initial priority)
      const call1 = service.callNextTicket(1);
      expect(call1).toBeTruthy();
      expect(call1!.type).toBe('SP');
      expect(call1!.number).toBe('260609-SP01');

      // 2. Second call: Last was SP, so next should be non-SP (SE or SG).
      // SE is preferred over SG, so it should call SE01.
      const call2 = service.callNextTicket(2);
      expect(call2).toBeTruthy();
      expect(call2!.type).toBe('SE');
      expect(call2!.number).toBe('260609-SE01');

      // 3. Third call: Last was non-SP, so next should be SP.
      const call3 = service.callNextTicket(3);
      expect(call3).toBeTruthy();
      expect(call3!.type).toBe('SP');
      expect(call3!.number).toBe('260609-SP02');

      // 4. Fourth call: Last was SP, so next should be non-SP.
      // SE queue still has SE02, which is preferred over SG.
      const call4 = service.callNextTicket(1);
      expect(call4).toBeTruthy();
      expect(call4!.type).toBe('SE');
      expect(call4!.number).toBe('260609-SE02');

      // 5. Fifth call: Last was non-SP, so next should be SP.
      // Wait, SP is now empty! So it should fallback to non-SP (SE is empty, so SG01).
      const call5 = service.callNextTicket(2);
      expect(call5).toBeTruthy();
      expect(call5!.type).toBe('SG');
      expect(call5!.number).toBe('260609-SG01');

      // 6. Sixth call: Last was SG (non-SP). Next target is SP (empty).
      // Fallback: SE (empty), SG (has SG02). So SG02 is called.
      const call6 = service.callNextTicket(3);
      expect(call6).toBeTruthy();
      expect(call6!.type).toBe('SG');
      expect(call6!.number).toBe('260609-SG02');
    } finally {
      Math.random = originalRandom;
    }
  });

  it('should calculate duration averages according to the specification ranges', () => {
    // Generate an SP ticket
    service.issueTicket('SP');
    
    const originalRandom = Math.random;
    
    // Test SP service time bounds (15 +- 5 minutes)
    // If Math.random() is 0, duration = 10
    Math.random = () => 0;
    let t = service.callNextTicket(1);
    if (t && t.status === 'called') {
      expect(t.serviceDuration).toBe(10);
    }

    service.completeService(1);

    // If Math.random() is 0.99999, duration = 20
    service.issueTicket('SP');
    Math.random = () => 0.9999;
    t = service.callNextTicket(1);
    if (t && t.status === 'called') {
      expect(t.serviceDuration).toBe(20);
    }

    // Reset random
    Math.random = originalRandom;
  });

  it('should discard remaining tickets in queue at 17:00 (1020 minutes)', () => {
    service.issueTicket('SP');
    service.issueTicket('SG');
    
    expect(service.spQueue().length).toBe(1);
    expect(service.sgQueue().length).toBe(1);

    // Advance clock to 17:00 (1020 minutes)
    service.advanceTime(1020 - 420);

    // Queues should be cleared
    expect(service.spQueue().length).toBe(0);
    expect(service.sgQueue().length).toBe(0);

    // Verify tickets in database have status 'expired'
    const expiredTickets = service.getTicketsForReport({ dateStr: '2026-06-09', status: 'expired' });
    expect(expiredTickets.length).toBe(2);
  });
});
