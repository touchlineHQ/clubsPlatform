import { useState } from 'react';
import { Text, SimpleGrid, Paper, Button, Stack, Collapse, Divider, Box, Group, Badge } from '@mantine/core';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import type { NewsItem } from '../types';
import { useSection } from '../context/SectionContext';
import { PageHeader } from '../components/club/PageHeader';
import { HeroBanner } from '../components/club/HeroBanner';
import { clubDesign } from '../theme';

interface Props { items: NewsItem[] }

function CardActions({ item }: { item: NewsItem }) {
  const [expanded, setExpanded] = useState(false);
  const hasBody = Boolean(item.body);

  if (hasBody) {
    return (
      <>
        <Collapse expanded={expanded}>
          <Divider my="sm" />
          <Stack gap="xs">
            {item.body!.split('\n\n').map((para, i) => (
              <Text key={i} size="sm" c={clubDesign.color.n7} lh={1.6}>{para}</Text>
            ))}
          </Stack>
        </Collapse>

        <Button
          variant="subtle"
          size="xs"
          onClick={() => setExpanded(e => !e)}
          rightSection={expanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          px={0}
          styles={{ root: { alignSelf: 'flex-start' } }}
          mt="xs"
        >
          {expanded ? 'Show Less' : item.linkText}
        </Button>
      </>
    );
  }

  return (
    <Button
      component="a"
      href={item.link}
      variant="outline"
      size="xs"
      radius="xl"
      styles={{ root: { alignSelf: 'flex-start' } }}
      mt="xs"
    >
      {item.linkText}
    </Button>
  );
}

function FeaturedCard({ item }: { item: NewsItem }) {
  return (
    <HeroBanner padding={28}>
      <Group gap="xs" mb={6}>
        {item.sections?.[0] && (
          <Badge variant="filled" radius="xl" size="sm">
            {item.sections[0]}
          </Badge>
        )}
      </Group>
      <Text
        ff={clubDesign.font.heading}
        fw={800}
        fz={{ base: 20, sm: 26 }}
        c="#fff"
        lh={1.2}
        mb="xs"
      >
        {item.title}
      </Text>
      <Text size="sm" c="rgba(255,255,255,0.7)" lh={1.6}>{item.text}</Text>
      {(item.body || item.link) && (
        <Box mt="md">
          {item.body ? (
            <FeaturedExpander item={item} />
          ) : (
            <Button component="a" href={item.link} variant="white" color="dark" radius="xl" size="xs">
              {item.linkText}
            </Button>
          )}
        </Box>
      )}
    </HeroBanner>
  );
}

function FeaturedExpander({ item }: { item: NewsItem }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Stack gap="xs">
      <Collapse expanded={expanded}>
        <Stack gap="xs" mt="sm">
          {item.body!.split('\n\n').map((para, i) => (
            <Text key={i} size="sm" c="rgba(255,255,255,0.8)" lh={1.6}>{para}</Text>
          ))}
        </Stack>
      </Collapse>
      <Button
        variant="white"
        color="dark"
        size="xs"
        radius="xl"
        onClick={() => setExpanded(e => !e)}
        rightSection={expanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        styles={{ root: { alignSelf: 'flex-start' } }}
      >
        {expanded ? 'Show Less' : item.linkText}
      </Button>
    </Stack>
  );
}

function StandardCard({ item }: { item: NewsItem }) {
  return (
    <Paper p="lg" radius="md" withBorder>
      <Stack gap="xs">
        {item.sections?.[0] && (
          <Group gap="xs">
            <Badge variant="light" radius="xl" size="sm">
              {item.sections[0]}
            </Badge>
          </Group>
        )}
        <Text fw={700} ff={clubDesign.font.heading} fz="md" lh={1.35}>
          {item.title}
        </Text>
        <Text size="sm" c="dimmed" lh={1.55}>{item.text}</Text>
        <CardActions item={item} />
      </Stack>
    </Paper>
  );
}

export function NewsPage({ items }: Props) {
  const { activeSection } = useSection();
  const visibleItems = items.filter(item =>
    activeSection === 'all' ||
    !item.sections ||
    item.sections.length === 0 ||
    item.sections.includes(activeSection)
  );

  const [featured, ...rest] = visibleItems;

  return (
    <Stack gap="lg">
      <PageHeader
        title="Club News"
        subtitle={`${visibleItems.length} ${visibleItems.length === 1 ? 'article' : 'articles'}`}
      />

      {featured && <FeaturedCard item={featured} />}

      {rest.length > 0 && (
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          {rest.map((item, i) => (
            <StandardCard key={i} item={item} />
          ))}
        </SimpleGrid>
      )}

      {visibleItems.length === 0 && (
        <Text c="dimmed">No news articles yet.</Text>
      )}
    </Stack>
  );
}
