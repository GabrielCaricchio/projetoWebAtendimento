import 'zone.js';
import 'zone.js/testing';
import { getTestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting
} from '@angular/platform-browser/testing';
import { ResourceLoader } from '@angular/compiler';

class MockResourceLoader extends ResourceLoader {
  override get(url: string): Promise<string> {
    // Retorna vazio para templateUrl/styleUrl externos em testes unitários simples
    return Promise.resolve('');
  }
}

getTestBed().initTestEnvironment(
  BrowserTestingModule,
  platformBrowserTesting(),
  {
    aotSummaries: () => []
  }
);

// Configura o compilador para usar o MockResourceLoader
getTestBed().configureCompiler({
  providers: [
    { provide: ResourceLoader, useClass: MockResourceLoader }
  ]
});
