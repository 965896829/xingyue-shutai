import { useEffect, useState } from 'react';
import type { ProjectConfig } from '../shared/types';
import type { ExpressionCatalog } from '../shared/expression';

const layers: Record<string, string> = {
  genre: '题材',
  tag: '设定',
  scene: '场景',
  relationship: '关系',
  form: '篇幅与形式',
  tone: '语气'
};

export function ExpressionSettings({
  value,
  onChange
}: {
  value: ProjectConfig['expressionRules'];
  onChange: (value: ProjectConfig['expressionRules']) => void;
}) {
  const [catalog, setCatalog] = useState<ExpressionCatalog>();
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void window
      .wenxu!.invoke<ExpressionCatalog>('expression.catalog')
      .then((data) => {
        if (active) setCatalog(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const modules = catalog?.modules.filter((m) => layers[m.layer]) ?? [];
  return (
    <div className="expression-settings">
      <div className="expression-heading">
        <label className="check">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
          />
          自然表达
        </label>
        {catalog && <small>规则库 {catalog.version}</small>}
      </div>
      {error && <p role="alert">{error}</p>}
      {value.enabled && (
        <details>
          <summary>题材与场景{value.modules.length > 0 ? ` · ${value.modules.length}` : ''}</summary>
          <input
            aria-label="搜索表达规则"
            placeholder="搜索题材、场景或语气"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="expression-modules">
            {Object.entries(layers).map(([layer, title]) => {
              const items = modules.filter(
                (m) =>
                  m.layer === layer &&
                  `${m.title} ${m.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
              );
              return (
                items.length > 0 && (
                  <fieldset key={layer}>
                    <legend>{title}</legend>
                    <div className="expression-options">
                      {items.map((m) => (
                        <label className="check" key={m.id}>
                          <input
                            type="checkbox"
                            checked={value.modules.includes(m.id)}
                            onChange={(e) =>
                              onChange({
                                ...value,
                                modules: e.target.checked
                                  ? [...value.modules, m.id]
                                  : value.modules.filter((id) => id !== m.id)
                              })
                            }
                          />
                          {m.title}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
