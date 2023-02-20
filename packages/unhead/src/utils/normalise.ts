import type { Head, HeadEntry, HeadTag } from '@unhead/schema'
import { TagConfigKeys, TagsWithInnerContent, ValidHeadTags, asArray } from '..'

export async function normaliseTag<T extends HeadTag>(tagName: T['tag'], input: HeadTag['props']): Promise<T | T[]> {
  const tag = { tag: tagName, props: {} } as T
  if (['title', 'titleTemplate'].includes(tagName)) {
    tag.textContent = (input instanceof Promise ? await input : input) as string
    return tag
  }
  // allow shorthands
  if (['script', 'noscript', 'style'].includes(tagName) && typeof input === 'string') {
    tag.innerHTML = input
    return tag
  }

  tag.props = await normaliseProps<T>(tagName, { ...input })

  // `children` is deprecated but still supported
  if (tag.props.children) {
    // inserting dangerous javascript potentially
    tag.props.innerHTML = tag.props.children
  }
  // clean up
  delete tag.props.children

  Object.keys(tag.props)
    .filter(k => TagConfigKeys.includes(k))
    .forEach((k) => {
      // strip innerHTML and textContent for tags which don't support it
      if (!['innerHTML', 'textContent'].includes(k) || TagsWithInnerContent.includes(tag.tag)) {
        // @ts-expect-error untyped
        tag[k] = tag.props[k]
      }
      delete tag.props[k]
    })

  // normalise tag content
  ;(['innerHTML', 'textContent'] as const).forEach((k) => {
    // avoid accidental XSS in json blobs
    if (tag.tag === 'script' && tag[k] && ['application/ld+json', 'application/json'].includes(tag.props.type)) {
      // recreate the json blob, ensure it's JSON
      try {
        // @ts-expect-error untyped
        tag[k] = JSON.parse(tag[k])
      }
      catch (e) {
        // invalid json, fail silently
        tag[k] = ''
      }
    }
    // always convert objects to strings
    if (typeof tag[k] === 'object')
      tag[k] = JSON.stringify(tag[k])
  })

  if (tag.props.class)
    tag.props.class = normaliseClassProp(tag.props.class)

  // allow meta to be resolved into multiple tags if an array is provided on content
  if (tag.props.content && Array.isArray(tag.props.content))
    return tag.props.content.map(v => ({ ...tag, props: { ...tag.props, content: v } } as T))

  return tag
}

export function normaliseClassProp(v: Required<Required<Head>['htmlAttrs']['class']>) {
  if (typeof v === 'object' && !Array.isArray(v)) {
    // @ts-expect-error untyped
    v = Object.keys(v).filter(k => v[k])
  }
  // finally, check we don't have spaces, we may need to split again
  return (Array.isArray(v) ? v.join(' ') : v as string)
    .split(' ')
    .filter(c => c.trim())
    .filter(Boolean)
    .join(' ')
}

export async function normaliseProps<T extends HeadTag>(tagName: T['tag'], props: T['props']): Promise<T['props']> {
  // handle boolean props, see https://html.spec.whatwg.org/#boolean-attributes
  for (const k of Object.keys(props)) {
    // data keys get special treatment, we opt for more verbose syntax
    const isDataKey = k.startsWith('data-')
    // first resolve any promises
    // @ts-expect-error untyped
    if (props[k] instanceof Promise) {
      // @ts-expect-error untyped
      props[k] = await props[k]
    }
    if (String(props[k]) === 'true') {
      // @ts-expect-error untyped
      props[k] = isDataKey ? 'true' : ''
    }
    else if (String(props[k]) === 'false') {
      if (isDataKey) {
        // @ts-expect-error untyped
        props[k] = 'false'
      }
      else {
        delete props[k]
      }
    }
  }
  return props
}

// support 1024 tag ids per entry (includes updates)
export const TagEntityBits = 10

export async function normaliseEntryTags<T extends {} = Head>(e: HeadEntry<T>): Promise<HeadTag[]> {
  const tagPromises: Promise<HeadTag | HeadTag[]>[] = []
  Object.entries(e.resolvedInput || e.input)
    .filter(([k, v]) => typeof v !== 'undefined' && ValidHeadTags.includes(k))
    .forEach(([k, value]) => {
      const v = asArray(value)
      // @ts-expect-error untyped
      tagPromises.push(...v.map(props => normaliseTag(k as keyof Head, props)).flat())
    })
  return (await Promise.all(tagPromises))
    .flat()
    .map((t: HeadTag, i) => {
      t._e = e._i
      t._p = (e._i << TagEntityBits) + i
      return t
    }) as unknown as HeadTag[]
}
