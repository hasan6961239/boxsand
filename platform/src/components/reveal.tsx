'use client';

import { motion, useReducedMotion, type Variants } from 'motion/react';
import type { ReactNode } from 'react';

interface RevealProps {
  children: ReactNode;
  delay?: number;
  /** المسافة التي يصعدها العنصر أثناء الظهور */
  y?: number;
  className?: string;
  as?: 'div' | 'section' | 'li' | 'article';
}

/**
 * ظهور تدريجي عند التمرير.
 *
 * المدة قصيرة والإزاحة صغيرة عمداً: الحركة هنا لتوحي بالجودة لا لتلفت النظر.
 * ومع تفضيل تقليل الحركة يظهر العنصر فوراً بلا أي إزاحة.
 */
export function Reveal({ children, delay = 0, y = 16, className, as = 'div' }: RevealProps) {
  const reduce = useReducedMotion();
  const Component = motion[as];

  if (reduce) return <Component className={className}>{children}</Component>;

  return (
    <Component
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </Component>
  );
}

/** حاوية تُظهر أبناءها واحداً تلو الآخر. */
export function Stagger({
  children,
  className,
  step = 0.07,
}: {
  children: ReactNode;
  className?: string;
  step?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;

  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: step } },
  };

  return (
    <motion.div
      className={className}
      variants={container}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-50px' }}
    >
      {children}
    </motion.div>
  );
}

const item: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
};

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} variants={item}>
      {children}
    </motion.div>
  );
}
