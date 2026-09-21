/* Réglages : produits & critères, partenaires, équipe, compte. */

import { state, shell, go, loadRefs, logout } from './app.js';
import { local, queue, sync } from './store.js';
import { db, auth } from './supa.js';
import { DEFAULT_GROUPS, DEFAULT_SETTINGS } from './catalog.js';
import { LANGS, builtinTranslation } from './report-pdf.js';
import { pressureConfig, fmtP, RANGE_TOL, SEV_STEPS } from './pressure.js';
import { PACKAGING_KINDS, TYPE_LIST, reportType, appliesTo, typesLabel } from './report-types.js';
import { $, $$, esc, icon, toast, sheet, confirmSheet, getTheme, setTheme } from './ui.js';

const isAdmin = () => state.profile?.role === 'admin';

export function renderSettings() {
  shell('Réglages', `
    <div class="menu">
      ${isAdmin() ? `
      <button class="menu-item" data-go="#/settings/groups"><span class="ic n">${icon('clipboard')}</span>
        <span class="tx"><b>Produits &amp; critères</b><span>Grilles de contrôle et seuils</span></span><span class="chev">›</span></button>
      <button class="menu-item" data-go="#/settings/partners"><span class="ic n">${icon('truck')}</span>
        <span class="tx"><b>Carnet d'adresses</b><span>${state.partners.length} enregistré${state.partners.length > 1 ? 's' : ''}</span></span><span class="chev">›</span></button>
      <button class="menu-item" data-go="#/settings/users"><span class="ic n">${icon('users')}</span>
        <span class="tx"><b>Équipe</b><span>Valider et gérer les accès</span></span><span class="chev">›</span></button>` : ''}
      <button class="menu-item" id="themeBtn"><span class="ic n">${icon('theme')}</span>
        <span class="tx"><b>Apparence</b><span>${themeLabel()}</span></span><span class="chev">›</span></button>
      <button class="menu-item" data-go="#/settings/account"><span class="ic n">${icon('badge')}</span>
        <span class="tx"><b>Mon compte</b><span>${esc(state.profile?.email || '')}</span></span><span class="chev">›</span></button>
    </div>`,
    { back: () => go('#/'),
      onMount() {
        $$('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
        $('#themeBtn').onclick = openTheme;
      } });
}

/* ========================== APPARENCE ========================== */
const THEMES = [
  ['auto',  'Automatique', "Suit le réglage du téléphone"],
  ['light', 'Clair',       "Fond blanc, plus lisible en plein jour"],
  ['dark',  'Sombre',      "Moins éblouissant en chambre froide"]
];
const themeLabel = () => THEMES.find(t => t[0] === getTheme())?.[1] || 'Automatique';

function openTheme() {
  sheet('Apparence', `<div class="list">${THEMES.map(([v, name, desc]) => `
    <button class="menu-item" data-t="${v}">
      <span class="ic n">${icon(v === 'auto' ? 'theme' : v === 'dark' ? 'moon' : 'sun')}</span>
      <span class="tx"><b>${name}</b><span>${esc(desc)}</span></span>
      <span class="chev">${getTheme() === v ? '✓' : '›'}</span></button>`).join('')}</div>`,
    { onMount(el, close) {
        el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
          setTheme(b.dataset.t);
          close();
          renderSettings();
          toast('Apparence : ' + themeLabel().toLowerCase());
        });
      } });
}


/* ------------------------ traductions ------------------------
   Les PDF partent chez des clients étrangers. Les grilles livrées
   sont traduites d'office ; dès que l'entreprise renomme un critère
   ou en crée un, c'est ici qu'elle fournit ses propres traductions.
   Sans elles, le critère reste en français dans le PDF — visible et
   corrigeable, plutôt qu'une traduction approximative. */
const OTHER_LANGS = Object.keys(LANGS).filter(l => l !== 'fr');

function i18nBlock(label, i18n) {
  const auto = builtinTranslation(label);
  return `<details class="sec" style="margin:2px 0 13px">
    <summary>Traductions du PDF
      <span class="count">${auto ? 'automatiques' : (i18n && Object.keys(i18n).length ? 'personnalisées' : 'à compléter')}</span>
      <span class="caret">▾</span></summary>
    <div class="body">
      <p class="muted" style="margin:0 0 10px">${auto
        ? "Ce libellé fait partie des grilles livrées : il est déjà traduit. Remplissez un champ pour imposer votre propre formulation."
        : "Laissez vide et le libellé français sera repris tel quel dans le PDF."}</p>
      ${OTHER_LANGS.map(l => `<div class="field"><label for="tr_${l}">${esc(LANGS[l])}</label>
        <input type="text" id="tr_${l}" value="${esc(i18n?.[l] || '')}"
               placeholder="${esc(auto?.[l] || label || '')}"></div>`).join('')}
    </div></details>`;
}

/* Portée : à quels types de rapport s'applique cette section ou ce
   critère. Aucun coché = tous, ce qui est le cas courant et évite
   d'avoir à cocher trois cases pour chaque nouveau critère. */
function typesBlock(item) {
  const sel = Array.isArray(item?.types) ? item.types : [];
  return `<div class="field"><label>Types de rapport concernés</label>
    <div class="tgrid" id="typesBox">
      ${TYPE_LIST.map(T => `<button type="button" class="tbtn" data-t="${T.id}"
        aria-pressed="${sel.includes(T.id)}">${esc(T.short)}</button>`).join('')}
    </div>
    <div class="hint">Aucun coché : le critère s'applique aux trois types de rapport.</div></div>`;
}

const readTypes = (el) => {
  const on = [...el.querySelectorAll('#typesBox .tbtn')]
    .filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.t);
  /* Les trois cochés, c'est « tous » : on n'enregistre rien, la grille
     reste ainsi valable si un quatrième type apparaît un jour. */
  return on.length && on.length < TYPE_LIST.length ? on : undefined;
};

const wireTypes = (el) => el.querySelectorAll('#typesBox .tbtn').forEach(b =>
  b.onclick = () => b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')));

const readI18n = (el) => {
  const out = {};
  for (const l of OTHER_LANGS) {
    const v = el.querySelector('#tr_' + l)?.value.trim();
    if (v) out[l] = v;
  }
  return Object.keys(out).length ? out : undefined;
};

/* ====================== PRODUITS & CRITÈRES ====================== */
export function renderGroups() {
  shell('Produits & critères', `
    <p class="muted" style="margin:0 0 12px">Chaque groupe porte sa propre grille. Ajoutez-en un pour couvrir
    un nouveau fruit ou légume : la structure de contrôle est identique, seuls les critères changent.</p>
    <div class="list">
      ${state.groups.map(g => `
        <button class="rep" data-id="${esc(g.id)}">
          <div class="rep-top"><b>${esc(g.config?.icon || '')} ${esc(g.name)}</b>${g.active ? '' : '<span class="pill">inactif</span>'}</div>
          <div class="rep-meta"><span>${(g.config?.sections || []).length} sections</span>
            <span>${(g.config?.sections || []).reduce((n, s) => n + s.fields.length, 0)} critères</span>
            <span>tolérance ${g.config?.tolerance ?? 10} %</span></div>
        </button>`).join('') || '<div class="empty"><div class="big">📦</div><p>Aucun groupe de produit.</p></div>'}
    </div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn ghost" id="add">${icon('plus')} Nouveau groupe</button>
      <button class="btn ghost" id="restore">Restaurer les grilles par défaut</button>
    </div>`,
    { back: () => go('#/settings'),
      onMount() {
        $$('[data-id]').forEach(b => b.onclick = () => go('#/settings/groups/' + b.dataset.id));
        $('#add').onclick = addGroup;
        $('#restore').onclick = async () => {
          if (!(await confirmSheet('Restaurer', 'Les grilles Avocat, Mangue et Fruits & légumes seront remises à leur état d\'origine. Les autres groupes ne sont pas touchés.', { okLabel: 'Restaurer', danger: false }))) return;
          await db('product_groups').upsert(DEFAULT_GROUPS.map(g => ({
            id: g.id, name: g.name, position: g.position, active: true, config: { ...g.config, icon: g.icon }
          })));
          await sync(); await loadRefs(); renderGroups(); toast('Grilles restaurées');
        };
      } });
}

function addGroup() {
  sheet('Nouveau groupe de produit', `
    <div class="field"><label for="gn">Nom</label><input type="text" id="gn" placeholder="Ex. Tomate, Raisin…"></div>
    <div class="field"><label for="gi">Emoji (facultatif)</label><input type="text" id="gi" maxlength="4" placeholder="🍅"></div>
    <div class="field"><label for="gb">Partir de</label>
      <select id="gb">${state.groups.map(g => `<option value="${esc(g.id)}">Copier « ${esc(g.name)} »</option>`).join('')}
        <option value="">Grille vide</option></select></div>
    <button class="btn block" id="ok">Créer</button>`,
    { onMount(el, close) {
        el.querySelector('#ok').onclick = async () => {
          const name = el.querySelector('#gn').value.trim();
          if (!name) return toast('Donnez un nom', 'err');
          const baseId = el.querySelector('#gb').value;
          const base = state.groups.find(g => g.id === baseId);
          const id = slug(name) + '-' + Math.random().toString(36).slice(2, 6);
          const row = {
            id, name, position: state.groups.length + 1, active: true,
            config: base ? structuredClone(base.config)
                         : { varieties: [], calibres: [], categories: ['Extra','I','II'], tolerance: 10, sections: [] }
          };
          row.config.icon = el.querySelector('#gi').value.trim() || '🧺';
          await local.put('groups', row);
          await queue('group', row);
          await sync({ silent: true }); await loadRefs();
          close(); go('#/settings/groups/' + id);
        };
      } });
}

/* Type de rapport sélectionné dans l'éditeur de grille. Gardé hors de
   la fonction pour survivre au redessin après chaque modification. */
let gridType = '';

export function renderGroupEditor(id) {
  const g = state.groups.find(x => x.id === id);
  if (!g) { toast('Groupe introuvable', 'err'); return go('#/settings/groups'); }
  const cfg = g.config || {};
  const pr = pressureConfig(g);

  shell(g.name, `
    <div class="card pad">
      <div class="row2">
        <div class="field"><label for="nm">Nom</label><input type="text" id="nm" value="${esc(g.name)}"></div>
        <div class="field"><label for="ic">Emoji</label><input type="text" id="ic" maxlength="4" value="${esc(cfg.icon || '')}"></div>
      </div>
      <div class="field"><label for="tol">Tolérance de non-conformité (%)</label>
        <input type="number" id="tol" step="0.5" value="${cfg.tolerance ?? 10}">
        <div class="hint">Au-delà, l'évaluation bascule en « Non Conforme ». 10 % correspond à la catégorie I des normes CEE-ONU.</div></div>
      <div class="field"><label for="vars">Variétés proposées</label>
        <textarea id="vars" style="min-height:64px">${esc((cfg.varieties || []).join(', '))}</textarea>
        <div class="hint">Séparées par des virgules.</div></div>
      <div class="field"><label for="cals">Calibres proposés</label>
        <textarea id="cals" style="min-height:64px">${esc((cfg.calibres || []).join(', '))}</textarea></div>
    </div>

    <div class="card pad" style="margin-top:12px">
      <h3 style="font-size:14.5px;margin-bottom:4px">Protocole de pression</h3>
      <p class="muted" style="margin:0 0 12px">Relevé au pénétromètre, facultatif à la saisie.
      Pour l'avocat : les deux joues de 5 fruits par palette.</p>
      <div class="row3">
        <div class="field"><label for="pf">Fruits / palette</label>
          <input type="number" id="pf" min="1" step="1" value="${pr.fruits}"></div>
        <div class="field"><label for="ps">Mesures / fruit</label>
          <input type="number" id="ps" min="1" step="1" value="${pr.sides}"></div>
        <div class="field"><label for="prf">Référence</label>
          <input type="number" id="prf" step="0.1" value="${pr.ref}"></div>
      </div>
      <div class="hint">La référence sert au bouton de remplissage rapide et à la ligne repère du graphique.</div>
    </div>

    <div class="card pad" style="margin-top:12px">
      <h3 style="font-size:14.5px;margin-bottom:4px">Poids minimum par calibre</h3>
      <p class="muted" style="margin:0 0 12px">Au contrôle production, un fruit pesé sous ce seuil
      est signalé comme sous-calibré. Laissez vide pour ne rien contrôler sur ce calibre.
      Le poids maximum n'est pas vérifié : un fruit plus gros profite au client.</p>
      <div class="wgrid">
        ${(cfg.calibres || []).map(c => `
          <div class="wrow">
            <label for="w_${slug(c)}">${esc(c)}</label>
            <span><input type="number" id="w_${slug(c)}" data-cal="${esc(c)}" min="0" step="1"
              value="${(cfg.calibreWeights || {})[c] ?? ''}" placeholder="—"><i>g</i></span>
          </div>`).join('') || '<p class="muted" style="margin:0">Définissez d\'abord les calibres ci-dessus.</p>'}
      </div>
    </div>

    <h3 style="margin:18px 0 6px;font-size:15px">Sections et critères</h3>
    <!-- On ne contrôle pas les mêmes choses à l'arrivée d'un conteneur
         et sur une chaîne de conditionnement. Ce filtre montre la
         grille telle qu'elle se présentera pour un type de rapport
         donné ; la restriction se règle critère par critère. -->
    <div class="chips" style="margin-bottom:10px">
      <button class="chip" data-tf="" aria-pressed="${!gridType}">Tous les rapports</button>
      ${TYPE_LIST.map(T => `<button class="chip" data-tf="${T.id}" aria-pressed="${gridType === T.id}">${esc(T.short)}</button>`).join('')}
    </div>
    ${gridType ? `<p class="muted" style="margin:0 0 10px">Grille telle qu'elle apparaîtra
      dans un ${esc(reportType(gridType).title.toLowerCase())}.</p>` : ''}
    ${(cfg.sections || []).map((sec, si) => {
      const shown = (sec.fields || []).filter(f => appliesTo(f, gridType));
      if (gridType && (!appliesTo(sec, gridType) || !shown.length)) return '';
      return `
      <details class="sec"><summary>${esc(sec.label)} <span class="count">${shown.length}</span>
        ${typesLabel(sec) ? `<span class="pill sm">${esc(typesLabel(sec))}</span>` : ''} <span class="caret">▾</span></summary>
        <div class="body">
          ${shown.map(f => {
            const fi = sec.fields.indexOf(f);
            return `
            <div class="crit" style="cursor:pointer" data-edit="${si}.${fi}">
              <span class="dot ${sevDot(f)}"></span>
              <span class="lb">${esc(f.label)}<small>${describe(f)}${
                typesLabel(f) ? ` · ${esc(typesLabel(f))} seulement` : ''}</small></span>
              <span style="color:var(--ink-3)">›</span>
            </div>`; }).join('')}
          <div class="btn-row" style="margin-top:10px">
            <button class="btn ghost sm" data-addf="${si}">${icon('plus')} Critère</button>
            <button class="btn ghost sm" data-editsec="${si}">${icon('edit')} Titre &amp; portée</button>
            <button class="btn ghost sm" data-delsec="${si}">Supprimer</button>
          </div>
        </div></details>`; }).join('')}

    <div class="btn-row" style="margin-top:12px">
      <button class="btn ghost" id="addsec">${icon('plus')} Section</button>
      <button class="btn ghost danger" id="delg">Supprimer le groupe</button>
    </div>
    <div class="sticky-actions"><button class="btn block" id="save">Enregistrer</button></div>`,
    { back: () => go('#/settings/groups'),
      onMount() {
        $$('[data-tf]').forEach(c => c.onclick = () => {
          gridType = c.dataset.tf === gridType ? '' : c.dataset.tf;
          renderGroupEditor(id);
        });
        $$('[data-edit]').forEach(el => el.onclick = () => {
          const [si, fi] = el.dataset.edit.split('.').map(Number);
          editField(g, si, fi);
        });
        $$('[data-addf]').forEach(el => el.onclick = () => editField(g, +el.dataset.addf, -1));
        $$('[data-delsec]').forEach(el => el.onclick = async () => {
          if (!(await confirmSheet('Supprimer la section', 'Ses critères seront retirés de la grille.'))) return;
          g.config.sections.splice(+el.dataset.delsec, 1);
          await saveGroup(g); renderGroupEditor(id);
        });
        $('#addsec').onclick = () => editSection(g, -1);
        $$('[data-editsec]').forEach(el => el.onclick = () => editSection(g, +el.dataset.editsec));
        $('#delg').onclick = async () => {
          if (!(await confirmSheet('Supprimer le groupe', 'Les rapports déjà saisis restent lisibles : chacun conserve une copie de sa grille.'))) return;
          await db('product_groups').eq('id', id).remove();
          await local.del('groups', id); await loadRefs();
          toast('Groupe supprimé'); go('#/settings/groups');
        };
        $('#save').onclick = async () => {
          g.name = $('#nm').value.trim() || g.name;
          g.config.icon = $('#ic').value.trim();
          g.config.tolerance = Number($('#tol').value) || 10;
          g.config.varieties = splitList($('#vars').value);
          g.config.calibres  = splitList($('#cals').value);
          const weights = {};
          $$('[data-cal]').forEach(inp => {
            const v = inp.value.trim();
            if (v !== '') weights[inp.dataset.cal] = Number(v);
          });
          g.config.calibreWeights = weights;
          g.config.pressure = {
            fruits: Math.max(1, Number($('#pf').value) || pr.fruits),
            sides:  Math.max(1, Number($('#ps').value) || pr.sides),
            ref:    Number($('#prf').value) || pr.ref,
            unit:   pr.unit
          };
          await saveGroup(g);
          toast('Enregistré'); go('#/settings/groups');
        };
      } });
}

/* Une section se crée, se renomme et se traduit au même endroit. */
function editSection(g, si) {
  const isNew = si < 0;
  const sec = isNew ? { id: '', label: '', fields: [] } : g.config.sections[si];
  sheet(isNew ? 'Nouvelle section' : 'Titre & portée', `
    <div class="field"><label for="sl">Titre</label>
      <input type="text" id="sl" value="${esc(sec.label)}" placeholder="Ex. Troubles / Maladies"></div>
    ${typesBlock(sec)}
    ${i18nBlock(sec.label, sec.i18n)}
    <button class="btn block" id="ok">${isNew ? 'Ajouter' : 'Enregistrer'}</button>`,
    { onMount(el, close) {
        wireTypes(el);
        el.querySelector('#ok').onclick = async () => {
          const label = el.querySelector('#sl').value.trim();
          if (!label) return toast('Donnez un titre', 'err');
          const i18n = readI18n(el), types = readTypes(el);
          if (isNew) (g.config.sections ||= []).push({ id: slug(label), label, i18n, types, fields: [] });
          else { sec.label = label; sec.i18n = i18n; sec.types = types; }
          await saveGroup(g); close(); renderGroupEditor(g.id);
        };
      } });
}

function editField(g, si, fi) {
  const sec = g.config.sections[si];
  const f = fi >= 0 ? structuredClone(sec.fields[fi])
    : { key: '', label: '', type: 'pct', severity: 'majeur',
        types: gridType ? [gridType] : undefined };
  const isNew = fi < 0;

  sheet(isNew ? 'Nouveau critère' : 'Modifier le critère', `
    <div class="field"><label for="cl">Libellé</label><input type="text" id="cl" value="${esc(f.label)}"></div>
    <div class="field"><label for="ct">Type</label>
      <select id="ct">
        <option value="pct"${f.type === 'pct' ? ' selected' : ''}>Pourcentage de défaut</option>
        <option value="num"${f.type === 'num' ? ' selected' : ''}>Mesure numérique</option>
        <option value="choice"${f.type === 'choice' ? ' selected' : ''}>Liste de choix</option>
        <option value="bool"${f.type === 'bool' ? ' selected' : ''}>Conforme / Non conforme</option>
      </select></div>
    <div class="field"><label for="cu">Unité</label><input type="text" id="cu" value="${esc(f.unit || '')}" placeholder="%, kg, °C, °Bx…"></div>
    <div class="field"><label for="cs">Gravité</label>
      <select id="cs">
        <option value="mineur"${f.severity === 'mineur' ? ' selected' : ''}>Mineur — passe en orange</option>
        <option value="majeur"${f.severity === 'majeur' ? ' selected' : ''}>Majeur — passe en rouge</option>
        <option value="critique"${f.severity === 'critique' ? ' selected' : ''}>Critique — non-conformité directe</option>
      </select></div>
    <div id="thr"></div>
    <div class="field" id="optBox" hidden><label for="co">Options</label>
      <textarea id="co" style="min-height:80px" placeholder="Bonne=ok&#10;Acceptable=warn&#10;Mauvaise=fail">${esc((f.options || []).map(o => `${o.v}=${o.s}`).join('\n'))}</textarea>
      <div class="hint">Une option par ligne, suivie de son statut : ok, warn ou fail.</div></div>
    ${typesBlock(f)}
    <div id="i18nBox">${i18nBlock(f.label, f.i18n)}</div>
    <div class="field"><label for="ch">Aide affichée sous le critère</label><input type="text" id="ch" value="${esc(f.hint || '')}"></div>
    <div class="btn-row">
      ${isNew ? '' : '<button class="btn ghost danger" style="flex:1" id="del">Supprimer</button>'}
      <button class="btn" style="flex:2" id="ok">${isNew ? 'Ajouter' : 'Enregistrer'}</button>
    </div>`,
    { onMount(el, close) {
        wireTypes(el);
        const typeSel = el.querySelector('#ct');
        const paintThr = () => {
          const t = typeSel.value;
          el.querySelector('#optBox').hidden = t !== 'choice';
          el.querySelector('#thr').innerHTML =
            t === 'pct' ? `<div class="row2">
                <div class="field"><label for="wa">Orange à partir de</label><input type="number" id="wa" step="0.1" value="${f.warnAt ?? ''}"></div>
                <div class="field"><label for="fa">Rouge à partir de</label><input type="number" id="fa" step="0.1" value="${f.failAt ?? ''}"></div></div>`
          : t === 'num' ? `<div class="row2">
                <div class="field"><label for="mn">Minimum accepté</label><input type="number" id="mn" step="0.1" value="${f.okMin ?? ''}"></div>
                <div class="field"><label for="mx">Maximum accepté</label><input type="number" id="mx" step="0.1" value="${f.okMax ?? ''}"></div></div>
                <p class="hint" style="margin:-6px 0 12px">Laissez vide pour une mesure purement informative, jamais notée.</p>`
          : '';
        };
        typeSel.onchange = paintThr; paintThr();

        const delBtn = el.querySelector('#del');
        if (delBtn) delBtn.onclick = async () => {
          close();
          if (!(await confirmSheet('Supprimer le critère', f.label))) return;
          sec.fields.splice(fi, 1);
          await saveGroup(g); renderGroupEditor(g.id);
        };

        el.querySelector('#ok').onclick = async () => {
          const label = el.querySelector('#cl').value.trim();
          if (!label) return toast('Donnez un libellé', 'err');
          const out = {
            key: f.key || slug(label).replace(/-/g, '_') + '_' + Math.random().toString(36).slice(2, 5),
            label, type: typeSel.value,
            unit: el.querySelector('#cu').value.trim() || undefined,
            severity: el.querySelector('#cs').value,
            hint: el.querySelector('#ch').value.trim() || undefined,
            types: readTypes(el),
            i18n: readI18n(el)
          };
          if (out.type === 'pct') {
            out.warnAt = numOrU(el.querySelector('#wa')?.value);
            out.failAt = numOrU(el.querySelector('#fa')?.value);
          } else if (out.type === 'num') {
            out.okMin = numOrU(el.querySelector('#mn')?.value);
            out.okMax = numOrU(el.querySelector('#mx')?.value);
            out.step = 0.01;
          } else if (out.type === 'choice') {
            out.options = el.querySelector('#co').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
              const [v, s] = l.split('=');
              return { v: v.trim(), s: (s || 'ok').trim() };
            });
          }
          if (fi >= 0) sec.fields[fi] = out; else sec.fields.push(out);
          await saveGroup(g); close(); renderGroupEditor(g.id);
        };
      } });
}

async function saveGroup(g) {
  await local.put('groups', g);
  await queue('group', { id: g.id, name: g.name, position: g.position, active: g.active, config: g.config });
  await sync({ silent: true });
  await loadRefs();
}

const sevDot = (f) => f.severity === 'critique' ? 'fail' : f.severity === 'majeur' ? 'warn' : 'none';
const describe = (f) => {
  if (f.type === 'pct') return `Défaut % · orange ≥ ${f.warnAt ?? '—'} · rouge ≥ ${f.failAt ?? '—'}`;
  if (f.type === 'num') return (f.okMin != null || f.okMax != null)
    ? `Mesure${f.unit ? ' (' + f.unit + ')' : ''} · accepté ${f.okMin ?? '−∞'} à ${f.okMax ?? '+∞'}` : 'Mesure informative';
  if (f.type === 'choice') return `Choix · ${(f.options || []).length} options`;
  return 'Conforme / Non conforme';
};
const splitList = (s) => s.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const numOrU = (v) => (v === '' || v == null) ? undefined : Number(v);

/* ======================== PARTENAIRES ======================== */
export function renderPartners() {
  const by = (k) => state.partners.filter(p => p.kind === k);
  const block = (title, kind) => `
    <h3 style="margin:16px 0 8px;font-size:15px">${title} <span class="muted">(${by(kind).length})</span></h3>
    <div class="list">${by(kind).map(p => `
      <button class="rep" data-p="${esc(p.id)}">
        <div class="rep-top"><b>${esc(p.name)}</b>${
          refCount(p) ? `<span class="pill n">${refCount(p)} référence${refCount(p) > 1 ? 's' : ''}</span>` : ''}</div>
        <div class="rep-meta">${[p.country, p.email, p.phone].filter(Boolean).map(esc).join(' · ') || '<span>—</span>'}</div>
      </button>`).join('') || '<p class="muted">Aucun pour l\'instant.</p>'}</div>`;

  shell("Carnet d'adresses", `
    ${block('Fournisseurs', 'fournisseur')}
    ${block('Clients', 'client')}
    ${block('Transporteurs', 'transporteur')}
    <div class="btn-row" style="margin-top:16px"><button class="btn ghost block" id="add">${icon('plus')} Ajouter</button></div>`,
    { back: () => go('#/settings'),
      onMount() {
        $$('[data-p]').forEach(b => b.onclick = () => editPartner(state.partners.find(p => p.id === b.dataset.p)));
        $('#add').onclick = () => editPartner(null);
      } });
}

/* Nombre de références de pression enregistrées pour un client. */
const refList = (p) => (p?.config?.pressureRefs || []);
const refCount = (p) => refList(p).length;

/* Cahier des charges du client : pression attendue par
   conditionnement. C'est ce que le rapport ira chercher tout seul
   quand on saisira ce client. Une ligne sans conditionnement sert de
   valeur par défaut pour tous les autres. */
function refRowsHtml(refs) {
  if (!refs.length)
    return `<p class="muted" style="margin:0 0 8px">Aucune référence. Sans elle, le rapport
      garde la valeur par défaut du produit et le contrôleur l'ajuste à la main.</p>`;
  return refs.map((r, i) => `
    <div class="ref-row" data-r="${i}">
      <select data-f="group" aria-label="Produit">
        <option value=""${!r.group ? ' selected' : ''}>Tous produits</option>
        ${state.groups.map(g => `<option value="${esc(g.id)}"${g.id === r.group ? ' selected' : ''}>${esc(g.config?.icon || '')} ${esc(g.name)}</option>`).join('')}
      </select>
      <select data-f="packaging" aria-label="Conditionnement">
        <option value=""${!r.packaging ? ' selected' : ''}>Tous conditionnements</option>
        ${PACKAGING_KINDS.map(k => `<option value="${esc(k)}"${k === r.packaging ? ' selected' : ''}>${esc(k)}</option>`).join('')}
      </select>
      <span class="seg sm" data-f="mode">
        <button type="button" data-m="target" aria-pressed="${r.mode !== 'range'}">Valeur</button>
        <button type="button" data-m="range" aria-pressed="${r.mode === 'range'}">Plage</button>
      </span>
      ${r.mode === 'range'
        ? `<span class="ref-in"><label>Mini <input type="number" step="0.1" data-f="min" value="${r.min ?? ''}"></label>
             <label>Maxi <input type="number" step="0.1" data-f="max" value="${r.max ?? ''}"></label></span>`
        : `<span class="ref-in"><label>Cible <input type="number" step="0.1" data-f="ref" value="${r.ref ?? ''}"></label></span>`}
      <button type="button" class="icon-btn" data-f="del" aria-label="Retirer cette référence">${icon('x')}</button>
    </div>`).join('');
}

function editPartner(p) {
  const isNew = !p;
  p = p || { id: crypto.randomUUID(), kind: 'fournisseur', name: '', active: true, config: {} };
  const refs = structuredClone(refList(p));
  sheet(isNew ? 'Nouveau partenaire' : p.name, `
    <div class="field"><label>Type</label>
      <div class="seg" id="kind">
        <button type="button" data-k="fournisseur" aria-pressed="${p.kind === 'fournisseur'}">Fournisseur</button>
        <button type="button" data-k="client" aria-pressed="${p.kind === 'client'}">Client</button>
        <button type="button" data-k="transporteur" aria-pressed="${p.kind === 'transporteur'}">Transporteur</button>
      </div></div>
    <div class="field"><label for="pn">Nom</label><input type="text" id="pn" value="${esc(p.name)}"></div>
    <div class="row2">
      <div class="field"><label for="pc">Pays</label><input type="text" id="pc" value="${esc(p.country || '')}"></div>
      <div class="field"><label for="pp">Téléphone</label><input type="text" id="pp" value="${esc(p.phone || '')}"></div>
    </div>
    <div class="field"><label for="pe">E-mail</label><input type="email" id="pe" value="${esc(p.email || '')}"></div>

    <div class="field" id="refWrap" ${p.kind === 'client' ? '' : 'hidden'}>
      <label>Pressions attendues</label>
      <div id="refRows"></div>
      <button type="button" class="btn ghost sm" id="refAdd">${icon('plus')} Ajouter une référence</button>
      <div class="hint">Appliquée automatiquement au rapport dès que ce client est saisi.
        Une valeur cible tolère ${SEV_STEPS.ok} point d'écart ; une plage en tolère ${RANGE_TOL}.<br>
        La règle la plus précise l'emporte : produit + conditionnement d'abord, puis produit seul,
        puis conditionnement seul, puis la ligne « tous ».</div>
    </div>

    <div class="btn-row">
      ${isNew ? '' : '<button class="btn ghost danger" style="flex:1" id="del">Supprimer</button>'}
      <button class="btn" style="flex:2" id="ok">Enregistrer</button></div>`,
    { onMount(el, close) {
        let kind = p.kind;
        const paintRefs = () => {
          el.querySelector('#refRows').innerHTML = refRowsHtml(refs);
          el.querySelectorAll('.ref-row').forEach(row => {
            const i = +row.dataset.r;
            row.querySelector('[data-f=group]').onchange = (e) => { refs[i].group = e.target.value; };
            row.querySelector('[data-f=packaging]').onchange = (e) => { refs[i].packaging = e.target.value; };
            row.querySelectorAll('[data-f=mode] button').forEach(b => b.onclick = () => {
              refs[i].mode = b.dataset.m;
              /* Passer en plage sans repartir de zéro : ±1 autour de la
                 cible, soit exactement sa tolérance. */
              if (refs[i].mode === 'range' && refs[i].min == null && refs[i].ref != null) {
                refs[i].min = Math.max(0, Number(refs[i].ref) - 1);
                refs[i].max = Number(refs[i].ref) + 1;
              }
              paintRefs();
            });
            ['ref', 'min', 'max'].forEach(f => {
              const inp = row.querySelector(`[data-f=${f}]`);
              if (inp) inp.oninput = () => { refs[i][f] = inp.value === '' ? null : Number(inp.value); };
            });
            row.querySelector('[data-f=del]').onclick = () => { refs.splice(i, 1); paintRefs(); };
          });
        };
        paintRefs();
        el.querySelector('#refAdd').onclick = () => {
          /* La nouvelle ligne reprend le produit de la précédente : on
             saisit en général les quatre conditionnements d'un même
             produit à la suite. */
          refs.push({ group: refs[refs.length - 1]?.group || '', packaging: '', mode: 'target', ref: 13 });
          paintRefs();
        };
        el.querySelectorAll('#kind button').forEach(b => b.onclick = () => {
          kind = b.dataset.k;
          el.querySelectorAll('#kind button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.k === kind)));
          el.querySelector('#refWrap').hidden = kind !== 'client';
        });
        const del = el.querySelector('#del');
        if (del) del.onclick = async () => {
          close();
          if (!(await confirmSheet('Supprimer', p.name))) return;
          await db('partners').eq('id', p.id).remove().catch(() => {});
          await local.del('partners', p.id); await loadRefs(); renderPartners();
        };
        el.querySelector('#ok').onclick = async () => {
          /* Une référence incomplète ne sert à rien et s'appliquerait
             silencieusement de travers : on ne garde que les lignes
             exploitables. */
          const keep = kind === 'client' ? refs.filter(r =>
            r.mode === 'range' ? (r.min != null && r.max != null) : r.ref != null) : [];
          const row = { ...p, kind, name: el.querySelector('#pn').value.trim(),
            country: el.querySelector('#pc').value.trim() || null,
            phone: el.querySelector('#pp').value.trim() || null,
            email: el.querySelector('#pe').value.trim() || null,
            config: { ...(p.config || {}), pressureRefs: keep } };
          if (!row.name) return toast('Donnez un nom', 'err');
          await local.put('partners', row);
          await queue('partner', row);
          await sync({ silent: true }); await loadRefs();
          close(); renderPartners();
        };
      } });
}

/* =========================== ÉQUIPE =========================== */
export async function renderUsers() {
  let users = [];
  try { users = await db('profiles').select('*').order('created_at', true); }
  catch (e) { toast(e.message, 'err'); }
  const waiting = users.filter(u => !u.approved);
  const active = users.filter(u => u.approved);

  const card = (u) => `
    <button class="rep" data-u="${esc(u.id)}">
      <div class="rep-top"><b>${esc(u.full_name || u.email)}</b>
        <span class="pill ${u.approved ? 'ok' : 'warn'}">${u.approved ? roleLabel(u.role) : 'à valider'}</span></div>
      <div class="rep-meta"><span>${esc(u.email || '')}</span></div>
    </button>`;

  shell('Équipe', `
    ${waiting.length ? `<h3 style="margin:0 0 8px;font-size:15px">En attente de validation</h3>
      <div class="list">${waiting.map(card).join('')}</div>` : ''}
    <h3 style="margin:${waiting.length ? '18px' : '0'} 0 8px;font-size:15px">Membres actifs</h3>
    <div class="list">${active.map(card).join('') || '<p class="muted">Aucun.</p>'}</div>
    <p class="muted" style="margin-top:16px">Un nouveau collègue crée son compte depuis l'écran de connexion :
    il apparaît ici en attente, et vous lui ouvrez l'accès.</p>`,
    { back: () => go('#/settings'),
      onMount() {
        $$('[data-u]').forEach(b => b.onclick = () => editUser(users.find(u => u.id === b.dataset.u)));
      } });
}

const roleLabel = (r) => ({ admin: 'Administrateur', inspecteur: 'Inspecteur', lecture: 'Lecture seule' }[r] || r);

function editUser(u) {
  const me = u.id === state.profile?.id;
  sheet(u.full_name || u.email, `
    <p class="muted" style="margin:0 0 14px">${esc(u.email || '')}</p>
    <div class="field"><label for="ur">Rôle</label>
      <select id="ur"${me ? ' disabled' : ''}>
        <option value="inspecteur"${u.role === 'inspecteur' ? ' selected' : ''}>Inspecteur — crée et modifie ses rapports</option>
        <option value="lecture"${u.role === 'lecture' ? ' selected' : ''}>Lecture seule — consulte et partage</option>
        <option value="admin"${u.role === 'admin' ? ' selected' : ''}>Administrateur — gère produits, critères et accès</option>
      </select>${me ? '<div class="hint">Vous ne pouvez pas modifier votre propre rôle.</div>' : ''}</div>
    <div class="btn-row">
      ${me ? '' : `<button class="btn ghost" style="flex:1" id="tog">${u.approved ? 'Suspendre' : 'Valider l\'accès'}</button>`}
      <button class="btn" style="flex:1" id="ok">Enregistrer</button></div>`,
    { onMount(el, close) {
        const tog = el.querySelector('#tog');
        if (tog) tog.onclick = async () => {
          try { await db('profiles').eq('id', u.id).update({ approved: !u.approved }); }
          catch (e) { return toast(e.message, 'err'); }
          close(); toast(u.approved ? 'Accès suspendu' : 'Accès validé'); renderUsers();
        };
        el.querySelector('#ok').onclick = async () => {
          if (!me) {
            try { await db('profiles').eq('id', u.id).update({ role: el.querySelector('#ur').value }); }
            catch (e) { return toast(e.message, 'err'); }
          }
          close(); renderUsers();
        };
      } });
}

/* ========================== MON COMPTE ========================== */
export function renderAccount() {
  shell('Mon compte', `
    <div class="card pad">
      <div class="kv"><span class="k">Nom</span><span class="v">${esc(state.profile?.full_name || '')}</span></div>
      <div class="kv"><span class="k">E-mail</span><span class="v">${esc(state.profile?.email || '')}</span></div>
      <div class="kv"><span class="k">Rôle</span><span class="v">${roleLabel(state.profile?.role)}</span></div>
      <div class="kv"><span class="k">Société</span><span class="v">${esc(state.settings.company)}</span></div>
    </div>
    ${isAdmin() ? `<div class="card pad" style="margin-top:12px">
      <div class="field"><label for="cn">Nom de la société (en-tête des PDF)</label>
        <input type="text" id="cn" value="${esc(state.settings.company)}"></div>
      <div class="field"><label for="dp">Départements / dépôts</label>
        <textarea id="dp" style="min-height:64px">${esc((state.settings.departments || []).join(', '))}</textarea>
        <div class="hint">Séparés par des virgules.</div></div>
      <button class="btn block" id="saveS">Enregistrer</button>
    </div>` : ''}
    <div class="card pad" style="margin-top:12px">
      <div class="field"><label for="np">Nouveau mot de passe</label>
        <input type="password" id="np" minlength="8" placeholder="8 caractères minimum"></div>
      <button class="btn ghost block" id="pw">Changer le mot de passe</button>
    </div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn ghost block" id="out">${icon('logout')} Se déconnecter</button>
    </div>
    <p class="muted" style="margin-top:18px">Données hébergées chez Supabase, région Paris (eu-west-3).
    Les photos sont privées : leur accès passe par un lien signé, valable une heure.</p>`,
    { back: () => go('#/settings'),
      onMount() {
        const s = $('#saveS');
        if (s) s.onclick = async () => {
          const value = { ...state.settings,
            company: $('#cn').value.trim() || state.settings.company,
            departments: splitList($('#dp').value) };
          try {
            await db('settings').upsert([{ key: 'app', value }]);
            state.settings = value; await local.meta('settings', value);
            toast('Enregistré');
          } catch (e) { toast(e.message, 'err'); }
        };
        $('#pw').onclick = async () => {
          const p = $('#np').value;
          if (p.length < 8) return toast('8 caractères minimum', 'err');
          try { await auth.updatePassword(p); $('#np').value = ''; toast('Mot de passe modifié'); }
          catch (e) { toast(e.message, 'err'); }
        };
        $('#out').onclick = async () => {
          if (await confirmSheet('Se déconnecter', 'Les rapports non synchronisés resteront sur cet appareil.', { okLabel: 'Se déconnecter' }))
            logout();
        };
      } });
}
