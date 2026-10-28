import { useEffect, useState, type CSSProperties } from 'react';
import { brand } from '../shared/brand';

const asset = (name: string) => `${import.meta.env.BASE_URL}brand/${name}.png`;
export const brandAssets = {
  app: asset('app-icon'),
  night: asset('night-symbol'),
  day: asset('day-symbol'),
  wordmark: asset('wordmark-day')
};

let decoded: Promise<void> | undefined;
function decodeBrandAssets() {
  return (decoded ??= Promise.all(
    Object.values(brandAssets).map(async (src) => {
      const image = new Image();
      image.src = src;
      await image.decode();
    })
  ).then(() => undefined));
}

/** Both symbols remain mounted: theme switches never fetch or swap an image mid-animation. */
export function BrandLogo({
  compact = false,
  symbolOnly = false
}: {
  compact?: boolean;
  symbolOnly?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void decodeBrandAssets().then(
      () => {
        if (active) setReady(true);
      },
      () => {
        if (active) setFailed(true);
      }
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <span
      className={`brand-logo${compact ? ' brand-logo-compact' : ''}${symbolOnly ? ' brand-logo-symbol' : ''}`}
      role="img"
      aria-label={brand.name}
      data-ready={ready}
      title={brand.name}
      style={
        {
          '--brand-wordmark-image': `url("${new URL(brandAssets.wordmark, document.baseURI).href}")`
        } as CSSProperties
      }
    >
      <span className="brand-symbol" aria-hidden="true">
        <img className="brand-symbol-night" src={brandAssets.night} alt="" draggable="false" />
        <img className="brand-symbol-day" src={brandAssets.day} alt="" draggable="false" />
      </span>
      {/* One stable alpha silhouette avoids double strokes while its ink color transitions. */}
      <span className="brand-wordmark" aria-hidden="true" />
      {failed && (
        <span className="brand-fallback" aria-hidden="true">
          {compact || symbolOnly ? '星' : brand.name}
        </span>
      )}
    </span>
  );
}
