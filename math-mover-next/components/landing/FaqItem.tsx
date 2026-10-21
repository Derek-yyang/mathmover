'use client';

import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import styles from '@/app/landing.module.css';

export function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const questionId = `${id}-question`;
  const answerId = `${id}-answer`;

  return (
    <div className={styles.faqItem} data-open={open}>
      <h3>
        <button type="button" id={questionId} className={styles.faqQuestion} aria-expanded={open} aria-controls={answerId} onClick={() => setOpen(previous => !previous)}>
          {question}<ChevronDown size={18} aria-hidden="true" />
        </button>
      </h3>
      <div id={answerId} className={styles.faqAnswer} role="region" aria-labelledby={questionId} aria-hidden={!open} inert={!open}>
        <div><p>{answer}</p></div>
      </div>
    </div>
  );
}
