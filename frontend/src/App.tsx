import { useEffect, useState } from "react";
import { api, money, stores, when, type CatalogRow, type CategoryOption, type HistoryResponse, type Job, type MatchGroup, type Schedule, type Stats } from "./api";

type View = "overview" | "products" | "collection" | "matches";

export function App() {
  const [view, setView] = useState<View>(readView);
  useEffect(() => {
    const sync = () => setView(readView());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  return (
    <div className="app">
      <aside className="nav">
        <div className="brand">
          <small>Monitor pet</small>
          <strong>Preços</strong>
        </div>
        <nav>
          <NavButton id="overview" current={view}>Visão geral</NavButton>
          <NavButton id="products" current={view}>Produtos</NavButton>
          <NavButton id="matches" current={view}>Revisão</NavButton>
          <NavButton id="collection" current={view}>Coleta</NavButton>
        </nav>
      </aside>
      <main className="main">
        {view === "overview" && <Overview />}
        {view === "products" && <Products />}
        {view === "matches" && <Matches />}
        {view === "collection" && <Collection />}
      </main>
    </div>
  );
}

function NavButton({ id, current, children }: { id: View; current: View; children: string }) {
  return (
    <button className={current === id ? "active" : ""} onClick={() => { window.location.hash = id; }}>
      {children}
    </button>
  );
}

function readView(): View {
  const hash = window.location.hash.replace("#", "");
  if (hash === "products" || hash === "matches" || hash === "collection") return hash;
  return "overview";
}

function Overview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.stats().then(setStats).catch((reason: Error) => setError(reason.message));
  }, []);
  if (error) return <p className="error">{error}</p>;
  if (!stats) return <p>Carregando a base…</p>;
  const max = Math.max(1, ...stats.byStore.map((item) => item.count));
  return (
    <>
      <header>
        <h1>Catálogo comparado</h1>
        <p className="lede">A pesquisa acontece sobre os preços já coletados de Cobasi, Petz, Petlove e Alfaderma. A última atualização foi {when(stats.lastUpdate)}.</p>
      </header>
      <section className="grid">
        <article className="card"><span>Produtos cadastrados</span><strong>{stats.totalProducts.toLocaleString("pt-BR")}</strong></article>
        <article className="card"><span>Produtos comparáveis</span><strong>{stats.comparableProducts.toLocaleString("pt-BR")}</strong></article>
        <article className="card"><span>Em promoção</span><strong>{stats.promotions.toLocaleString("pt-BR")}</strong></article>
        <article className="card"><span>Preço reduzido</span><strong>{stats.priceReduced.toLocaleString("pt-BR")}</strong></article>
      </section>
      <section className="panel bars">
        <h2>Por loja</h2>
        {stats.byStore.map((item) => (
          <div className="bar" key={item.store}>
            <span>{item.store}</span>
            <div className="track"><span style={{ width: `${(item.count / max) * 100}%` }} /></div>
            <strong>{item.count.toLocaleString("pt-BR")}</strong>
          </div>
        ))}
        <p className="muted">{stats.comparableGroups.toLocaleString("pt-BR")} grupos equivalentes e {stats.needsReview.toLocaleString("pt-BR")} correspondências aguardando revisão.</p>
      </section>
    </>
  );
}

function Products() {
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [store, setStore] = useState("");
  const [promo, setPromo] = useState(false);
  const [comparable, setComparable] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [sort, setSort] = useState("price");
  const [categories, setCategories] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.filters().then((filters) => {
      setCategories(filters.categories);
      setBrands(filters.brands);
    }).catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "25", sort, direction: sort === "discount" ? "desc" : "asc" });
    if (search) params.set("search", search);
    if (category) params.set("category", category);
    if (brand) params.set("brand", brand);
    if (store) params.set("store", store);
    if (promo) params.set("promo", "true");
    if (comparable) params.set("comparable", "true");
    if (reduced) params.set("reduced", "true");
    api.products(params).then((result) => {
      setRows(result.rows);
      setTotal(result.total);
    }).catch((reason: Error) => setError(reason.message));
  }, [page, search, category, brand, store, promo, comparable, reduced, sort]);

  const exportHref = (format: "csv" | "xlsx", kind: "catalog" | "comparison") => {
    const params = new URLSearchParams({ format, kind, sort });
    if (search) params.set("search", search);
    if (category) params.set("category", category);
    if (brand) params.set("brand", brand);
    if (store) params.set("store", store);
    if (promo) params.set("promo", "true");
    if (comparable) params.set("comparable", "true");
    if (reduced) params.set("reduced", "true");
    return `/api/export?${params}`;
  };

  return (
    <>
      <header>
        <h1>Produtos coletados</h1>
        <p className="lede">A busca filtra a base local. Ela não consulta os sites de novo.</p>
      </header>
      <div className="filters">
        <input className="search" value={search} placeholder="Buscar na base coletada" onChange={(event) => { setPage(1); setSearch(event.target.value); }} />
        <select value={category} onChange={(event) => { setPage(1); setCategory(event.target.value); }}>
          <option value="">Todas as categorias</option>
          {categories.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select value={brand} onChange={(event) => { setPage(1); setBrand(event.target.value); }}>
          <option value="">Todas as marcas</option>
          {brands.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select value={store} onChange={(event) => { setPage(1); setStore(event.target.value); }}>
          <option value="">Todas as lojas</option>
          {stores.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="price">Menor preço</option>
          <option value="name">Nome</option>
          <option value="discount">Maior desconto</option>
        </select>
      </div>
      <div className="choice">
        <label className="check"><input type="checkbox" checked={promo} onChange={(event) => { setPage(1); setPromo(event.target.checked); }} /> Em promoção</label>
        <label className="check"><input type="checkbox" checked={comparable} onChange={(event) => { setPage(1); setComparable(event.target.checked); }} /> Só comparáveis</label>
        <label className="check"><input type="checkbox" checked={reduced} onChange={(event) => { setPage(1); setReduced(event.target.checked); }} /> Preço reduzido</label>
      </div>
      <div className="actions">
        <a className="primary" href={exportHref("csv", "comparison")}>CSV da comparação</a>
        <a className="ghost" href={exportHref("xlsx", "comparison")}>Excel da comparação</a>
        <a className="ghost" href={exportHref("csv", "catalog")}>CSV do catálogo</a>
        <a className="ghost" href={exportHref("xlsx", "catalog")}>Excel do catálogo</a>
      </div>
      {error && <p className="error">{error}</p>}
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produto</th><th>Marca</th><th>Categoria</th>{stores.map((store) => <th key={store}>{store}</th>)}<th>Menor preço</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td className="empty" colSpan={4 + stores.length}>Nenhum produto encontrado na base com esses filtros.</td></tr>}
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.name}</strong>
                  <small className="sub">{row.packageSize || "Tamanho não informado"}{row.comparable ? " · comparável" : ""}{row.matchStatus === "needs_review" ? " · revisar" : ""}</small>
                </td>
                <td>{row.brand || "—"}</td>
                <td>{row.category || "—"}</td>
                {stores.map((storeName) => <td key={storeName}><Price cell={row.prices[storeName]} best={row.lowestStore === storeName} onOpen={setHistory} /></td>)}
                <td className="price best">{money(row.lowestPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="pager">
        <button className="ghost" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Anterior</button>
        <span>{total.toLocaleString("pt-BR")} registros · página {page}</span>
        <button className="ghost" disabled={page * 25 >= total} onClick={() => setPage((current) => current + 1)}>Próxima</button>
      </div>
      {history && <HistoryDrawer history={history} onClose={() => setHistory(null)} />}
    </>
  );
}

function Price({ cell, best, onOpen }: { cell?: CatalogRow["prices"]["Cobasi"]; best: boolean; onOpen: (history: HistoryResponse) => void }) {
  if (!cell) return <>—</>;
  return (
    <button className="ghost" onClick={() => api.history(cell.productId).then(onOpen)}>
      <span className={best ? "price best" : "price"}>{money(cell.price)}</span>
      {cell.originalPrice != null && <small className="old">{money(cell.originalPrice)}</small>}
      {cell.discountPercentage != null && <span className="badge">-{cell.discountPercentage}%</span>}
    </button>
  );
}

function HistoryDrawer({ history, onClose }: { history: HistoryResponse; onClose: () => void }) {
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <aside className="drawer">
        <h2>{history.product.name}</h2>
        <p className="muted">{history.product.store}</p>
        <p>Mínimo {money(history.min)} · máximo {money(history.max)} · média {money(history.avg)}</p>
        <p>Variação desde a primeira coleta: {history.variationPercent.toLocaleString("pt-BR")}%</p>
        <ul>
          {history.product.history.map((point) => (
            <li key={point.collectedAt}>{when(point.collectedAt)} — {money(point.price)} · {point.availability || "sem status"}</li>
          ))}
        </ul>
        <a href={history.product.productUrl} target="_blank" rel="noreferrer">Abrir na loja</a>
      </aside>
    </>
  );
}

function Collection() {
  const [selected, setSelected] = useState<string[]>([...stores]);
  const [maxPages, setMaxPages] = useState("");
  const [delayMs, setDelayMs] = useState(800);
  const [categories, setCategories] = useState<Record<string, CategoryOption[]>>({});
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [jobs, setJobs] = useState<Job[]>([]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [message, setMessage] = useState("");
  const [loadingStore, setLoadingStore] = useState("");

  const refresh = () => api.jobs().then(setJobs).catch((reason: Error) => setMessage(reason.message));
  useEffect(() => {
    refresh();
    api.schedule().then(setSchedule).catch((reason: Error) => setMessage(reason.message));
    const timer = window.setInterval(refresh, 2500);
    return () => window.clearInterval(timer);
  }, []);

  async function loadCategories(store: string) {
    setLoadingStore(store);
    setMessage("");
    try {
      const result = await api.categories(store);
      setCategories((current) => ({ ...current, [store]: result }));
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Não foi possível ler as categorias");
    } finally {
      setLoadingStore("");
    }
  }

  async function start() {
    const broad = selected.some((store) => !(picked[store]?.length));
    const unlimited = !maxPages;
    if (broad && unlimited && !window.confirm("A coleta completa percorre todas as categorias pet e pode levar horas. A Petz e a Petlove abrem uma janela visível do Edge. Continuar?")) return;
    setMessage("");
    try {
      await api.createJob({
        stores: selected,
        categories: picked,
        maxPages: maxPages ? Number(maxPages) : null,
        delayMs,
      });
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Falha ao iniciar");
    }
  }

  async function saveSchedule() {
    if (!schedule) return;
    const saved = await api.saveSchedule({
      enabled: schedule.enabled,
      intervalHours: schedule.intervalHours,
      stores: schedule.stores.split(",").filter(Boolean),
      delayMs: schedule.delayMs,
    });
    setSchedule(saved);
  }

  return (
    <>
      <header>
        <h1>Coleta</h1>
        <p className="lede">Cobasi e Alfaderma usam APIs públicas de catálogo. Petz e Petlove só respondem em uma janela real do Edge; clientes headless recebem bloqueio e ele não é contornado. O preço de clube e assinatura não entra na comparação.</p>
      </header>
      <section className="panel">
        <div className="choice">
          {stores.map((store) => (
            <label className="check" key={store}>
              <input type="checkbox" checked={selected.includes(store)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, store] : current.filter((item) => item !== store))} />
              {store}
            </label>
          ))}
        </div>
        <div className="filters">
          <label className="field">Páginas por categoria <input value={maxPages} placeholder="todas" onChange={(event) => setMaxPages(event.target.value)} /></label>
          <label className="field">Pausa (ms) <input type="number" min={400} value={delayMs} onChange={(event) => setDelayMs(Number(event.target.value))} /></label>
          <button className="primary" onClick={start}>Iniciar coleta</button>
        </div>
        {selected.map((store) => (
          <div key={store}>
            <div className="actions">
              <strong>{store}</strong>
              <button className="ghost" onClick={() => loadCategories(store)}>{loadingStore === store ? "Lendo…" : "Carregar categorias"}</button>
            </div>
            {categories[store] && (
              <div className="category-list">
                {categories[store].map((category) => (
                  <label key={category.id}>
                    <input
                      type="checkbox"
                      checked={picked[store]?.includes(category.id) ?? false}
                      onChange={(event) => setPicked((current) => {
                        const values = new Set(current[store] ?? []);
                        if (event.target.checked) values.add(category.id);
                        else values.delete(category.id);
                        return { ...current, [store]: [...values] };
                      })}
                    />
                    <span>{category.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
        {message && <p className="error">{message}</p>}
      </section>
      {schedule && (
        <section className="panel">
          <h2>Agenda</h2>
          <div className="filters">
            <label className="check"><input type="checkbox" checked={schedule.enabled} onChange={(event) => setSchedule({ ...schedule, enabled: event.target.checked })} /> Ativa</label>
            <select value={schedule.intervalHours} onChange={(event) => setSchedule({ ...schedule, intervalHours: Number(event.target.value) })}>
              <option value={12}>A cada 12 horas</option>
              <option value={24}>Diária</option>
              <option value={168}>Semanal</option>
            </select>
            <button className="ghost" onClick={saveSchedule}>Salvar agenda</button>
          </div>
          <p className="muted">Próxima execução: {when(schedule.nextRunAt)}</p>
        </section>
      )}
      <section className="panel">
        <h2>Execuções</h2>
        {jobs.length === 0 && <p className="empty">Nenhuma coleta ainda.</p>}
        {jobs.map((job) => (
          <article key={job.id}>
            <div className="actions">
              <strong>{job.stores}</strong>
              <span className="badge">{job.status}</span>
              <span>{job.productsFound.toLocaleString("pt-BR")} encontrados · {job.productsNew.toLocaleString("pt-BR")} novos · {job.productsUpdated.toLocaleString("pt-BR")} atualizados · {job.errorCount} erros</span>
              {(job.status === "running" || job.status === "queued") && <button className="danger" onClick={() => api.cancelJob(job.id).then(refresh)}>Cancelar</button>}
            </div>
            {job.log && <pre className="log">{job.log}</pre>}
          </article>
        ))}
      </section>
    </>
  );
}

function Matches() {
  const [groups, setGroups] = useState<MatchGroup[]>([]);
  const [error, setError] = useState("");
  const load = () => api.matches().then(setGroups).catch((reason: Error) => setError(reason.message));
  useEffect(() => { load(); }, []);

  async function decide(id: string, decision: "confirmed" | "rejected") {
    await api.decide(id, decision);
    await load();
  }

  return (
    <>
      <header>
        <h1>Correspondências duvidosas</h1>
        <p className="lede">O pareamento exige a mesma marca, espécie, peso, volume, quantidade e sabor. Esta lista mostra só os casos que ficaram abaixo da confiança automática.</p>
      </header>
      {error && <p className="error">{error}</p>}
      {groups.length === 0 && <section className="panel empty">Nenhuma correspondência pendente.</section>}
      {groups.map((group) => (
        <article className="panel" key={group.id}>
          <h2>{group.canonicalName}</h2>
          <p className="muted">{group.brand || "Marca não informada"} · {group.packageSize || "sem peso"} · similaridade {Math.round(group.similarity * 100)}%</p>
          <ul>
            {group.members.map((member) => (
              <li key={member.product.id}>
                {member.product.store}: {member.product.name} — {money(member.product.price)}{" "}
                <a href={member.product.productUrl} target="_blank" rel="noreferrer">ver</a>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button className="primary" onClick={() => decide(group.id, "confirmed")}>Confirmar</button>
            <button className="danger" onClick={() => decide(group.id, "rejected")}>Rejeitar</button>
          </div>
        </article>
      ))}
    </>
  );
}
