// M0 placeholder: the document the simulated run "produces", so the editor can be opened and tried.
// M1 replaces it with the real Gemini output.
export function buildSampleDocument(fileName: string, chunks: number): string {
  const safeName = fileName.replace(/[<>&"]/g, '');
  const sections = Array.from({ length: chunks }, (_, i) => `
<h2>Parte ${i + 1}</h2>
<p>Questo paragrafo rappresenta il blocco audio ${i + 1} di ${chunks}. Nella versione completa qui comparirà la sbobinatura prodotta da Gemini, con <strong>termini importanti in grassetto</strong> e <em>citazioni in corsivo</em>.</p>
<ul>
  <li>Primo concetto chiave del blocco ${i + 1}</li>
  <li>Secondo concetto, con un esempio pratico</li>
</ul>`).join('');
  return `<h1>${safeName}</h1>
<p><strong>Documento di esempio (versione web M0):</strong> nessun audio è stato inviato a Gemini. Il testo serve solo a provare l'editor, la copia per Google Docs e l'archivio.</p>${sections}
<h2>Riepilogo</h2>
<ol>
  <li>La sbobinatura reale arriva con la milestone M1.</li>
  <li>Puoi modificare questo testo: le modifiche restano in questo browser.</li>
</ol>
`;
}
