// Minimal Highlight.js language definition for modern free-form RPG (a.k.a. RPGLE).
// The grammar focuses on the constructs we render in docs and mirrors the pattern we
// already use for COBOL by keeping the registration code small and dependency free.
export default function rpg(hljs) {
    const KEYWORDS = {
        keyword: [
            'dcl-s',
            'dcl-ds',
            'dcl-subf',
            'dcl-pi',
            'dcl-pr',
            'dcl-proc',
            'dcl-c',
            'eval',
            'evalr',
            'for',
            'endfor',
            'dow',
            'enddo',
            'if',
            'else',
            'elseif',
            'endif',
            'select',
            'when',
            'other',
            'endsl',
            'monitor',
            'on-error',
            'endmon',
            'leave',
            'return',
            'begsr',
            'endsr',
            'callp',
            'seton',
            'setoff',
            'exec',
            'sql'
        ].join(' '),
        literal: '*on *off *zeros *loval *hival *blanks *null *omit',
        built_in: [
            '%addr',
            '%alloc',
            '%char',
            '%check',
            '%date',
            '%days',
            '%dec',
            '%diff',
            '%div',
            '%editc',
            '%editflt',
            '%editw',
            '%int',
            '%len',
            '%lookup',
            '%lookupgt',
            '%lookupge',
            '%lookuple',
            '%lookuplt',
            '%occurs',
            '%subst',
            '%size',
            '%trim',
            '%triml',
            '%trimr',
            '%ucase'
        ].join(' ')
    };

    const PERCENT_FUNCTION = {
        className: 'built_in',
        begin: /%[a-z_][a-z0-9_]*/i
    };

    return {
        name: 'RPG',
        aliases: ['rpgle', 'rpg'],
        case_insensitive: true,
        keywords: KEYWORDS,
        contains: [
            hljs.C_LINE_COMMENT_MODE,
            hljs.COMMENT(/\/\*/, /\*\//),
            // Old, column-based inline comments are still common in snippets that start with "**".
            hljs.COMMENT(/^\s*\*\*.*/, /$/),
            hljs.APOS_STRING_MODE,
            hljs.QUOTE_STRING_MODE,
            hljs.C_NUMBER_MODE,
            PERCENT_FUNCTION
        ]
    };
}
