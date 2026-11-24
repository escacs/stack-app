// Unknown top-level route (`#/foo`): say so, and offer the three real places.
import { href } from '../router';
import { LinkButton } from '../ui';

export function NotFound(props: { scenario: string; segs: string[] }) {
  const path = () => `/${props.segs.join('/')}`;
  return (
    <section class="notfound" aria-labelledby="notfound-title">
      <h1 id="notfound-title" class="doc-title">That page does not exist</h1>
      <p class="doc-lead">
        Nothing lives at <code class="mono">{path()}</code>. The link may be old or mistyped.
      </p>
      <p class="notfound__links">
        <LinkButton href={href(props.scenario, 'project')}>Project</LinkButton>
        <LinkButton href={href(props.scenario, 'browse')}>Browse the catalog</LinkButton>
        <LinkButton href={href(props.scenario, 'browse', 'presets')}>Presets</LinkButton>
      </p>
    </section>
  );
}
